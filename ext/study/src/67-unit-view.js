// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 67: A UNIT — the tab
// ═══════════════════════════════════════════════════════════════════════════════
//
// One tab per unit ('unit-<subjectId>-<rowId>', titled "<Subject> · <Unit>"):
// everything of the unit in one place, by kind. Notes and files (what he
// attached, each opened in its own editor with one press), Questions (its
// questions by their last result; Study Questions… and Open Questions), then
// one group per tool that reports progress, in that tool's words, whose bar
// opens the tool on those items through its provider (no tool is named
// here). The header has the unit's setup, Study…, as its main action.
// "Add Notes or Files…" picks from every page and file; "Find Matches…" on
// the subject proposes what is named like a unit, and attaches only what he
// ticks. The arithmetic is 15-unit-model.js; the reading and writing
// 31-unit-material.js; the bars are Progress's (14, 28).

/** An item's icon by its kind: a canvas page, a PDF, a picture, text, any other file. */
const ST_UNIT_ICONS = { page: 'notebook-text', pdf: 'file-text', image: 'file-image', text: 'file-type', file: 'file' };

const stUnitInstanceId = (subjectId, rowId) => `unit-${Number(subjectId) || 0}-${rowId}`;

/** The unit tab that was just asked for and has not taken the focus yet ('': none). */
let _stUnitFocusFor = '';

/** Open a unit's tab (or bring it forward) and put the focus on its Study…: a press from the sidebar goes on from there. */
async function stOpenUnit(subjectId, rowId) {
  const instanceId = stUnitInstanceId(subjectId, rowId);
  _stUnitFocusFor = instanceId;
  const opened = await stOpenPane({ view: 'unit', subjectId: Number(subjectId) || 0, rowId: String(rowId) });
  const page = Array.from(document.querySelectorAll('.st-unit')).find((n) => n.isConnected && n.dataset.instance === instanceId);
  if (page) stUnitTakeFocus(instanceId, page);
  return opened;
}

/** The focus onto the tab's Study…, once, for the tab that was asked for. */
function stUnitTakeFocus(instanceId, page) {
  if (!page || _stUnitFocusFor !== instanceId) return;
  _stUnitFocusFor = '';
  const study = page.querySelector('[data-px-id="study.unit.study"]');
  if (study && typeof study.focus === 'function') study.focus();
}

/** The unit a command names: its row id, or its name (the subject's first unit of that name). */
function stUnitNamed(s, unit) {
  if (!s || unit === undefined || unit === null || unit === '') return null;
  return s.units.find((u) => u.rowId === unit) || s.units.find((u) => stSubjectSameName(u.name, unit)) || null;
}

/** Open Unit…: a unit's tab; with no unit named, his pick of the subject's units. */
async function stCmdOpenUnit(subject, unit) {
  const s = await stPickSubject(subject, 'Which subject?');
  const u = s ? await stPickUnit(s, unit, 'Open which unit?') : null;
  return u ? stOpenUnit(s.id, u.rowId) : null;
}

/** A subject's unit: the one named (row id or name), else his pick among its units. */
async function stPickUnit(s, unit, placeholder) {
  const named = stUnitNamed(s, unit);
  if (named) return named;
  if (!s.units.length) { await _api.window.showInformationMessage(`${s.name} has no units yet. Add them in Open Units.`); return null; }
  const pick = await _api.window.showQuickPick(s.units.map((x) => ({ label: x.name, rowId: x.rowId })), { placeholder });
  return pick ? s.units.find((x) => x.rowId === pick.rowId) || null : null;
}

/** Open one of a unit's items (its key) in its own editor. */
async function stCmdOpenUnitItem(subjectId, rowId, key) {
  const { row } = stUnitRowOf(subjectId, rowId);
  if (!row) return false;
  const shown = (await stUnitShown(stUnitCell(row), await stUnitPages())).find((i) => i.key === key);
  if (!shown) return false;
  await stUnitOpen(shown);
  return true;
}

/** Take one item (its key) off a unit; the page or the file stays as it is. */
async function stCmdRemoveUnitItem(subjectId, rowId, key) {
  try { return await stUnitDetach(subjectId, rowId, key); } catch (err) {
    if (!stIsStopped(err)) await _api.window.showWarningMessage(stSentence(stErrText(err)));
    return false;
  }
}

let _stUnitWhereSeq = 0;

/** Add Notes or Files…: the picker for a unit (by its row id or its name); with none named, his pick. */
async function stCmdAddNotesOrFiles(subject, unit) {
  const s = await stPickSubject(subject, 'Which subject?');
  const u = s ? await stPickUnit(s, unit, 'Add to which unit?') : null;
  return u ? stUnitPick(s.id, u.rowId) : false;
}

/** Unit Actions…: the unit's menu at its row's More Actions in the sidebar, else a pick. */
async function stCmdUnitActions(subject, unit) {
  const s = await stPickSubject(subject, 'Which subject?');
  const u = s ? stUnitNamed(s, unit) : null;
  if (!s || !u) return null;
  const items = stUnitMenuItems(s, u);
  const at = Array.from(document.querySelectorAll('[data-px-id]')).find((n) => n.getAttribute('data-px-id') === `study.side.unit.${s.id}.${u.rowId}.more` && n.getClientRects().length);
  if (at) { _api.ui.showContextMenu(at, items, { anchorPosition: 'below' }); return null; }
  const pick = await _api.window.showQuickPick(items.map((i) => ({ label: i.label })), { placeholder: u.name });
  const chosen = pick ? items.find((i) => i.label === pick.label) : null;
  if (chosen) chosen.onSelect();
  return null;
}

/** A unit's actions: its row's More Actions and context menu in the sidebar. */
function stUnitMenuItems(s, u) {
  return [
    { label: 'Study…', icon: 'px-study', onSelect: () => { stNoteSheetOpener(); void stOpenSetup({ bankIds: [s.subject.bankId], unit: u.name }); } },
  ];
}

/** What the picker says of an item: its kind when the name does not, and where it lives. */
function stUnitDescribe(c) {
  return [c.kind === 'page' ? 'Page' : '', c.where].filter(Boolean).join(' · ');
}

/** Add Notes or Files…: every page and file, searchable by name and place, several at once; the ticked ones are attached to the unit. */
async function stUnitPick(subjectId, rowId) {
  const { st, row } = stUnitRowOf(subjectId, rowId);
  if (!st || !row) return false;
  const unit = String(row.title || '').trim();
  const all = await stUnitCandidates();
  const have = new Set(stUnitItems(stUnitCell(row), stUnitRoot()).map((i) => i.key));
  const items = all.map((c) => ({ label: c.label, description: [stUnitDescribe(c), have.has(c.key) ? 'attached' : ''].filter(Boolean).join(' · '), candidate: c }));
  const picked = await _api.window.showQuickPick(items, { placeholder: `Find pages and files to attach to ${unit}`, canPickMany: true, matchOnDescription: true, confirmLabel: 'Attach' });
  if (!Array.isArray(picked) || !picked.length) return false;
  try {
    await stUnitAttach(subjectId, rowId, picked.map((p) => p.candidate.item));
  } catch (err) {
    if (!stIsStopped(err)) await _api.window.showWarningMessage(stSentence(stErrText(err)));
    return false;
  }
  return true;
}

/** Find Matches…: the pages and files named like a unit (or an Also Called of it), each with its unit, all unticked; Attach Selected attaches the ticked ones. */
async function stUnitFindMatches(subjectId) {
  const st = _stSubjects.get(Number(subjectId));
  if (!st || !st.synced) return false;
  const root = stUnitRoot();
  const units = stProgressUnitsOf(st).map((u) => {
    const row = (st.unitRows || []).find((r) => r.pageId === u.rowId);
    return { ...u, attached: new Set(stUnitItems(stUnitCell(row), root).map((i) => i.key)) };
  });
  const all = await stUnitCandidates();
  const proposals = stUnitProposals(units, all.map((c) => ({ ...c, label: c.kind === 'page' ? c.label : stUnitStem(c.label), shown: c.label })));
  if (!proposals.length) {
    await _api.window.showInformationMessage(`No page or file is named like a unit of ${st.subject.name}. Add the names they go by to Also Called in Units.`);
    return false;
  }
  const items = proposals.map((p) => ({ label: p.candidate.shown, description: [`to ${p.unit}`, stUnitDescribe(p.candidate)].filter(Boolean).join(' · '), proposal: p }));
  const picked = await _api.window.showQuickPick(items, { placeholder: `Tick what belongs to its unit in ${st.subject.name}`, canPickMany: true, matchOnDescription: true, confirmLabel: 'Attach Selected' });
  if (!Array.isArray(picked) || !picked.length) return false;
  const byUnit = new Map();
  for (const p of picked) {
    const u = units.find((x) => x.name === p.proposal.unit);
    if (!u) continue;
    if (!byUnit.has(u.rowId)) byUnit.set(u.rowId, []);
    byUnit.get(u.rowId).push(p.proposal.candidate.item);
  }
  for (const [rowId, list] of byUnit) await stUnitAttach(subjectId, rowId, list);
  return true;
}

async function renderUnit(host, route, ctx) {
  const subjectId = Number(route.subjectId) || 0;
  const rowId = String(route.rowId || '');
  const instanceId = stUnitInstanceId(subjectId, rowId);
  const ui = _api.ui;
  const page = ui.createBlock(host, 'div', { className: 'st-unit', attrs: { 'data-instance': instanceId } });
  const inner = ui.createBlock(page, 'div', { className: 'st-unit__in' });
  const now = () => {
    const s = stSubjectsShown().find((x) => x.id === subjectId) || null;
    return { s, u: s ? s.units.find((x) => x.rowId === rowId) || null : null };
  };
  const first = now();
  if (!first.s || !first.u) {
    // A tab that came back with the app is drawn before Study has read its subjects: it waits for them, and says so only when the unit is gone.
    ctx.add(onDataChanged(() => { const n = now(); if (n.s && n.u) ctx.rerender(); }));
    const kept = await db.get('SELECT id FROM st_subjects WHERE id = ?', [subjectId]).catch(() => null);
    const st = _stSubjects.get(subjectId);
    if (!ctx.disposed() && (!kept || (st && st.synced && !first.u))) ui.createEmptyState(inner, { icon: 'graduation-cap', headline: kept ? 'This unit is no longer in Units.' : 'This subject is no longer in Study.', hint: 'Its pages and files are where they were.', action: { label: 'Close', command: ST_CLOSE_TAB } });
    return;
  }
  const subject = first.s.subject;
  let unitName = first.u.name;

  const header = ui.createPageHeader(inner, {
    title: `${subject.name} · ${unitName}`,
    primary: { id: 'study.unit.study', label: 'Study…', icon: 'px-study', title: `Study ${unitName}`, command: 'study.studySubject', args: [subjectId, rowId] },
    more: [
      { label: 'Open Progress', icon: 'chart-column', onSelect: () => void stOpenProgress(subjectId) },
      { label: 'Open Units', icon: 'database', onSelect: () => void stOpenSubjectDatabase(subject.unitsDb) },
    ],
  });
  const title = header.querySelector('.px-page-header__title');
  const body = ui.createBlock(inner, 'div', { className: 'st-unit__body' });
  let seq = 0;
  /** A group: its heading with its count, its actions, then what it holds. */
  const group = (into, name) => {
    const sec = ui.createBlock(into, 'section', { className: 'st-unit__sec' });
    const hd = ui.createBlock(sec, 'div', { className: 'st-unit__hd' });
    const h = ui.createBlock(hd, 'div', { className: 'st-unit__name', text: name, attrs: { role: 'heading', 'aria-level': '2' } });
    h.id = `st-unit-${instanceId}-${++seq}`;
    sec.setAttribute('aria-labelledby', h.id);
    h.appendChild(document.createTextNode(' '));
    const n = ui.createBlock(h, 'span', { className: 'st-unit__n' });
    const acts = ui.createBlock(hd, 'div', { className: 'st-unit__acts' });
    const box = ui.createBlock(sec, 'div', { className: 'st-unit__box' });
    return { sec, h, n, acts, box, count: (k) => { n.textContent = String(k); } };
  };

  // The two groups every unit has: drawn once, so their buttons stay what they are while the lists under them change.
  const notes = group(body, 'Notes and files');
  ui.createButton(notes.acts, { id: 'study.unit.add', label: 'Add Notes or Files…', icon: 'plus', kind: 'ghost', size: 'sm', command: 'study.addNotesOrFiles', args: [subjectId, rowId] });
  const questions = group(body, 'Questions');
  ui.createButton(questions.acts, { id: 'study.unit.studyQuestions', label: 'Study Questions…', icon: 'px-study', kind: 'ghost', size: 'sm', command: 'study.studySubject', args: [subjectId, rowId] });
  ui.createButton(questions.acts, { id: 'study.unit.openQuestions', label: 'Open Questions', icon: 'database', kind: 'ghost', size: 'sm', command: 'canvas.openPage', args: [subject.questionsDb] });
  const tools = ui.createBlock(body, 'div', { className: 'st-unit__tools' });

  let bars = [];
  let drawn = '';
  const dropBars = () => { for (const b of bars) b.dispose(); bars = []; };
  /** A kind's bar and its counts in its own words. */
  const counted = (box, owner, kind, counts, words, act, action) => {
    const line = ui.createBlock(box, 'div', { className: 'st-unit__bar' });
    bars.push(ui.createStackedBar(line, { label: stProgressBarName(owner, kind, counts, words), parts: stProgressParts(owner, kind, counts, words, { idBase: `study.unit.${slug(kind)}`, act, action }) }));
    ui.createBlock(box, 'div', { className: 'st-unit__words', text: stUnitCountsLine(counts, words), attrs: { 'aria-hidden': 'true' } });
  };
  const slug = (v) => (typeof ui.sceneSlug === 'function' ? ui.sceneSlug(String(v)) : String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const focusKey = (n) => (n ? n.getAttribute('data-px-id') || n.getAttribute('aria-label') || '' : '');

  async function paint() {
    if (ctx.disposed()) return;
    const n = now();
    if (!n.s || !n.u) { ctx.rerender(); return; }
    unitName = n.u.name;
    const { st, row } = stUnitRowOf(subjectId, rowId);
    const cell = stUnitCell(row);
    const progress = stProgressOfSubject(subjectId);
    const prow = progress ? progress.rows.find((r) => r.rowId === rowId) : null;
    const pages = stUnitPagesNow();
    const shown = await stUnitShown(cell, pages);
    if (ctx.disposed()) return;
    const key = JSON.stringify([unitName, n.s.problem, shown.map((i) => [i.key, i.title, i.where, i.missing]), prow ? prow.kinds.map((k) => [k.id, k.kind, k.counts, k.words, k.canOpen, k.groups]) : null]);
    if (key === drawn) return;
    drawn = key;
    const focused = body.contains(document.activeElement) ? focusKey(document.activeElement) : '';
    const scroll = page.scrollTop;
    const label = `${subject.name} · ${unitName}`;
    if (title && title.textContent !== label) title.textContent = label;
    dropBars();

    // Notes and files.
    notes.count(shown.length);
    notes.box.replaceChildren();
    if (!shown.length) ui.createBlock(notes.box, 'div', { className: 'st-unit__none', text: 'Nothing attached yet. Add the pages and files that are your notes for this unit.' });
    else {
      const list = ui.createBlock(notes.box, 'div', { className: 'st-unit__list', attrs: { role: 'list' } });
      for (const it of shown) {
        const line = ui.createBlock(list, 'div', { className: `st-unit__item${it.missing ? ' st-unit__item--gone' : ''}`, attrs: { role: 'listitem' } });
        const icon = it.missing ? 'file-question' : ST_UNIT_ICONS[it.kind] || 'file';
        const open = ui.createButton(line, { id: null, label: it.title, icon, kind: 'ghost', size: 'sm', command: 'study.openUnitItem', args: [subjectId, rowId, it.key] });
        open.classList.add('st-unit__open');
        const where = it.missing ? (it.kind === 'page' ? 'Missing: in the Trash or deleted' : 'Missing: moved or deleted') : it.where;
        open.setAttribute('aria-label', `Open ${it.title}`);
        if (where) {
          // Where it lives, or that it is missing, is the button's description: the name stays "Open <title>".
          const whereId = `st-unit-where-${++_stUnitWhereSeq}`;
          ui.createBlock(open, 'span', { className: `st-unit__where${it.missing ? ' st-unit__where--gone' : ''}`, text: where, attrs: { id: whereId } });
          open.setAttribute('aria-describedby', whereId);
        }
        const rm = ui.createIconButton(line, { id: null, icon: 'x', title: `Remove ${it.title} from ${unitName}`, size: 'sm', command: 'study.removeUnitItem', args: [subjectId, rowId, it.key] });
        rm.classList.add('st-unit__rm');
      }
    }

    // Questions, in his words.
    const own = prow ? prow.kinds.find((k) => k.id === ST_PROGRESS_QUESTIONS) : null;
    const qCounts = own ? own.counts : stProgressZero();
    questions.count(qCounts[0] + qCounts[1] + qCounts[2] + qCounts[3]);
    questions.box.replaceChildren();
    if (!own) ui.createBlock(questions.box, 'div', { className: 'st-unit__none', text: 'No questions in this unit yet. Add them to its Questions database, with this unit as their Unit.' });
    else counted(questions.box, unitName, 'Questions', qCounts, ST_PROGRESS_WORDS, (state) => ({ command: 'study.studySubject', args: [subjectId, unitName, state] }), 'Study these');

    // One group per tool that reports progress for this unit, in its own words.
    tools.replaceChildren();
    for (const k of prow ? prow.kinds.filter((x) => x.id !== ST_PROGRESS_QUESTIONS) : []) {
      const g = group(tools, k.kind);
      g.count(k.counts[0] + k.counts[1] + k.counts[2] + k.counts[3]);
      const act = k.canOpen ? (state) => ({ command: 'study.openProgress', args: [subjectId, { provider: k.id, groups: k.groups.map((x) => x.group), state }] }) : null;
      counted(g.box, unitName, k.kind, k.counts, k.words, act, 'Open these');
    }

    page.scrollTop = scroll;
    if (focused) {
      const again = Array.from(body.querySelectorAll('button, [tabindex]')).find((x) => focusKey(x) === focused);
      if (again) again.focus();
    }
    // A page renamed since it was attached: its entry in Material is named as it is now, so the table says the same.
    if (pages && st && row) {
      const next = stUnitRetitled(cell, (id) => (pages.get(id) ? pages.get(id).title : undefined), stUnitRoot());
      if (next) void stUnitWrite(st, rowId, next).catch(() => { /* the tab shows the title all the same */ });
    }
  }

  let timer = 0;
  let painting = Promise.resolve();
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { painting = painting.then(paint, paint); }, 30); };
  ctx.add(onDataChanged(later));
  ctx.add(bus.on('progress', later));
  ctx.add(bus.on('unit', later));
  ctx.add({ dispose: () => { clearTimeout(timer); dropBars(); } });
  // Shown again (its tab brought forward): what is on disk and in the canvas is looked at afresh.
  if (typeof IntersectionObserver === 'function') {
    let wasShown = true;
    const seen = new IntersectionObserver((entries) => {
      const on = entries.some((e) => e.isIntersecting);
      if (on && !wasShown) { stUnitFilesForget(); later(); }
      wasShown = on;
    });
    seen.observe(page);
    ctx.add({ dispose: () => seen.disconnect() });
  }
  stProgressWant();
  painting = paint();
  await painting;
  stUnitTakeFocus(instanceId, page);
  // The pages' titles and places, read once, then the list again.
  void stUnitPages().then(() => { if (!ctx.disposed()) later(); });
}
