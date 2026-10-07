// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 50: SIDEBAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════
//
// The desk (mockup section 10): every material with its coverage and, for the
// expanded PDF, its chapters; the sessions open now and the finished ones
// under them; the question banks folded. Select Materials turns the icon
// column into checks and Study Together starts one session over the pick.
// Chrome is the kit's (icon buttons, section labels, the empty state, the
// context menu, the confirm modal); the rows are Study's own rules on tokens.
// Repaints on bus 'data' and 'session'; every listener goes on dispose.

/** Mode word for a session row and the toolbar scope line. */
const ST_MODE_LABELS = { practice: 'Practice', test: 'Test', learn: 'Learn', weak: 'Weak Spots' };
/** Answer-format word for the toolbar scope line. */
const ST_ANSWER_LABELS = { choose: 'Choose', type: 'Type', mixed: 'Mixed' };

/** bus.on returns a dispose; accept a function or a disposable so the part
 *  works whichever shape 00-header.js settles on. */
function stOff(handle) {
  try {
    if (typeof handle === 'function') handle();
    else if (handle && typeof handle.dispose === 'function') handle.dispose();
  } catch { /* noop */ }
}

/** The icon for a material row, by kind. */
function stMaterialIcon(kind) {
  if (kind === 'pdf') return 'file-text';
  if (kind === 'canvas') return 'notebook-text';
  return 'database';
}

/** "today", "yesterday", a weekday within the week, else "3 Oct". Local
 *  dates on purpose: the sidebar says when the owner studied, in their day. */
function stRelativeDay(ts, now) {
  if (!ts) return '';
  const a = new Date(ts), b = new Date(now);
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  const days = Math.round((dayB - dayA) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return a.toLocaleDateString(undefined, { weekday: 'short' });
  return a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A two-segment coverage bar: green share clean, accent share answered but
 *  not clean (weak or stale). `className` is st-mini (sidebar) or st-ocov. */
function stCoverageBar(className, cov) {
  const bar = el('span', className);
  const total = cov && cov.total ? cov.total : 0;
  const clean = total ? Math.round((cov.clean / total) * 100) : 0;
  const working = total ? Math.round(((cov.weak + cov.stale) / total) * 100) : 0;
  const c = el('i', 'st-cov-c'); c.style.width = `${clean}%`; bar.appendChild(c);
  const w = el('i', 'st-cov-w'); w.style.width = `${working}%`; bar.appendChild(w);
  bar.title = total ? `${cov.clean} of ${total} concepts clean` : 'No concepts yet';
  return bar;
}

/** stCoverage over a concept list with the configured stale window. */
function stCoverageOf(concepts, now) {
  return stCoverage(concepts || [], now, { staleDays: Number(cfg('staleDays', 14)) || 14 });
}

/** Flatten the canvas page tree into quick-pick rows, path as the description. */
function stFlattenPageTree(nodes, path = [], out = []) {
  for (const n of nodes || []) {
    const title = n.title || n.name || 'Untitled';
    out.push({ label: title, description: path.join(' / '), id: n.id });
    if (Array.isArray(n.children) && n.children.length) stFlattenPageTree(n.children, [...path, title], out);
  }
  return out;
}

/** Add PDF…: the workspace pick, ingest, then the setup sheet. Shared by the
 *  header's + menu and the empty state. */
async function stAddPdfFlow() {
  const fsPath = await stPickWorkspacePdf();
  if (!fsPath) return;
  const material = await stIngestPdf(fsPath);
  _emitDataChanged();
  if (material) await stOpenSetup({ materialIds: [material.id] });
}

/** Add Canvas Page…: a quick pick over the page tree, ingest, then the sheet. */
async function stAddCanvasPageFlow() {
  let tree = [];
  try { tree = await _api.workspace.getCanvasPageTree(); } catch { tree = []; }
  const items = stFlattenPageTree(tree);
  if (!items.length) {
    await _api.window.showInformationMessage('No canvas pages in this workspace.');
    return;
  }
  const pick = await _api.window.showQuickPick(items, { placeholder: 'Choose a page', matchOnDescription: true });
  if (!pick || !pick.id) return;
  const material = await stIngestCanvasPage(pick.id);
  _emitDataChanged();
  if (material) await stOpenSetup({ materialIds: [material.id] });
}

function createSidebarView(container) {
  injectStyles();
  const root = el('div', 'st-sb');
  container.appendChild(root);

  const state = {
    disposed: false,
    selecting: false,
    picked: new Set(),
    expandedId: null,
    banksOpen: false,
    activeSessionId: null,
  };

  // ── Header: Select Materials, +, ⋯ ──
  const header = el('div', 'st-sb__hd');
  header.appendChild(el('span', 'st-sp'));
  const selectIcon = _api.icons && typeof _api.icons.hasIcon === 'function' && _api.icons.hasIcon('check-square') ? 'check-square' : 'square-check';
  const selectBtn = _api.ui.createIconButton(header, {
    icon: selectIcon, title: 'Select Materials', size: 'sm',
    onClick: () => {
      state.selecting = !state.selecting;
      if (!state.selecting) { state.picked.clear(); stSetPicked([]); }
      void paint();
    },
  });
  selectBtn.setAttribute('aria-pressed', 'false');
  const addBtn = _api.ui.createIconButton(header, {
    icon: 'plus', title: 'Add Material', size: 'sm',
    onClick: () => {
      _api.ui.showContextMenu(addBtn, [
        { label: 'Add PDF…', icon: 'file-text', onSelect: () => void stAddPdfFlow() },
        { label: 'Add Canvas Page…', icon: 'notebook-text', onSelect: () => void stAddCanvasPageFlow() },
      ], { anchorPosition: 'below' });
    },
  });
  const moreBtn = _api.ui.createIconButton(header, {
    icon: 'ellipsis', title: 'More Actions', size: 'sm',
    onClick: () => {
      _api.ui.showContextMenu(moreBtn, [
        { label: 'Import Questions…', icon: 'database', onSelect: () => void _api.commands.executeCommand('study.importQuestions') },
        { label: "Import Examiner's Report…", icon: 'file-check', onSelect: () => void _api.commands.executeCommand('study.importReport') },
      ], { anchorPosition: 'below' });
    },
  });
  root.appendChild(header);

  const body = el('div', 'st-sb__body');
  root.appendChild(body);

  // ── Rows ──
  const sectionLabel = (host, text, count, { fold = null } = {}) => {
    const row = el('div', 'st-sb__secl' + (fold ? ' st-sb__secl--fold' : ''));
    const label = _api.ui.createSectionLabel(null, text);
    if (fold) {
      const chev = el('span', '');
      chev.innerHTML = icon(fold.open ? 'chevron-down' : 'chevron-right', 12);
      label.prepend(chev);
      label.addEventListener('click', () => fold.onToggle());
      label.setAttribute('role', 'button');
      label.setAttribute('aria-expanded', fold.open ? 'true' : 'false');
    }
    if (count != null) label.appendChild(el('span', 'st-sb__n', String(count)));
    row.appendChild(label);
    host.appendChild(row);
    return row;
  };

  const materialRow = (m, cov, concepts) => {
    const row = el('div', 'st-sb__it st-sb__it--material');
    row.dataset.materialId = String(m.id);
    row.title = m.label;
    if (state.selecting) {
      const on = state.picked.has(m.id);
      const ck = el('span', 'st-sb__ck' + (on ? ' st-sb__ck--on' : ''));
      ck.innerHTML = icon('check', 12);
      row.appendChild(ck);
      if (on) row.classList.add('st-sb__it--picked');
    } else {
      const ic = el('span', '');
      ic.innerHTML = icon(stMaterialIcon(m.kind), 14);
      row.appendChild(ic);
      if (state.expandedId === m.id) row.classList.add('st-sb__it--on');
    }
    row.appendChild(el('span', 'st-sb__nm', m.label));
    row.appendChild(stCoverageBar('st-mini', cov));
    row.addEventListener('click', () => {
      if (state.selecting) {
        if (state.picked.has(m.id)) state.picked.delete(m.id); else state.picked.add(m.id);
        stSetPicked([...state.picked]); // the Study Together command reads the pick
        void paint();
        return;
      }
      state.expandedId = m.id;
      void paint();
      void stOpenSetup({ materialIds: [m.id] });
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _api.ui.showContextMenu({ x: e.clientX, y: e.clientY }, [
        { label: 'Learn', icon: 'book-open', onSelect: () => void stOpenPane({ view: 'learn', materialId: m.id, sectionId: 0 }) },
        { label: 'Study…', icon: 'px-study', onSelect: () => void stOpenSetup({ materialIds: [m.id] }) },
        { separator: true },
        { label: 'Remove', icon: 'trash', danger: true, onSelect: () => void removeMaterial(m, concepts) },
      ]);
    });
    return row;
  };

  const chapterRow = (m, s, concepts, now) => {
    const row = el('div', 'st-sb__it st-sb__it--sub');
    row.dataset.sectionId = String(s.id);
    row.title = s.title;
    row.appendChild(el('span', 'st-sb__nm', s.title));
    const inSection = concepts.filter((c) => c.sectionId === s.id);
    const cov = stCoverageOf(inSection, now);
    let text, cls = 'st-sb__r';
    if (!inSection.length) { text = 'no bank'; cls += ' st-faint'; }
    else if (cov.clean === cov.total) text = 'clean';
    else { text = `${cov.clean} / ${cov.total}`; if (cov.weak > 0) cls += ' st-sb__r--weak'; }
    row.appendChild(el('span', cls, text));
    row.addEventListener('click', () => void stOpenSetup({ materialIds: [m.id], sectionId: s.id }));
    return row;
  };

  const sessionRow = (s, items, now) => {
    const row = el('div', 'st-sb__it st-sb__it--session');
    row.dataset.sessionId = String(s.id);
    const finished = !!s.finishedAt;
    const name = `${s.name} · ${ST_MODE_LABELS[s.mode] || s.mode}`;
    row.title = name;
    if (!finished) {
      row.appendChild(el('span', 'st-sb__live'));
    } else {
      const ic = el('span', '');
      ic.innerHTML = icon('px-study', 14);
      row.appendChild(ic);
    }
    if (state.activeSessionId === s.id) row.classList.add('st-sb__it--on');
    row.appendChild(el('span', 'st-sb__nm', name));
    const list = items || [];
    const lastDraw = list.reduce((m, i) => Math.max(m, i.draw || 0), 0);
    const drawItems = list.filter((i) => (i.draw || 0) === lastDraw);
    const total = drawItems.length || s.size || 0;
    if (!finished) {
      const answered = drawItems.filter((i) => i.status && i.status !== 'pending').length;
      row.appendChild(el('span', 'st-sb__r', `${answered} / ${total}`));
    } else {
      const right = drawItems.filter((i) => i.status === 'right').length;
      row.appendChild(el('span', 'st-sb__r', `${right}/${total} · ${stRelativeDay(s.finishedAt, now)}`));
    }
    row.addEventListener('click', () => void stOpenPane({ view: finished ? 'results' : 'session', sessionId: s.id }));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _api.ui.showContextMenu({ x: e.clientX, y: e.clientY }, [
        { label: 'Delete Session', icon: 'trash', danger: true, onSelect: () => void deleteSession(s) },
      ]);
    });
    return row;
  };

  const bankRow = (b) => {
    const row = el('div', 'st-sb__it st-sb__it--bank');
    row.dataset.bankId = String(b.id);
    const ic = el('span', '');
    ic.innerHTML = icon('database', 14);
    row.appendChild(ic);
    row.appendChild(el('span', 'st-sb__nm', b.name));
    row.title = b.name;
    row.appendChild(el('span', 'st-sb__r', `${b.count || 0} · ${b.kind}`));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _api.ui.showContextMenu({ x: e.clientX, y: e.clientY }, [
        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => void deleteBank(b) },
      ]);
    });
    return row;
  };

  // ── Destructive flows, each behind the app's confirm modal ──
  async function removeMaterial(m, concepts) {
    const ok = await _api.window.showConfirmModal({
      message: `Remove ${m.label}?`,
      detail: `Its ${(concepts || []).length} concepts, their questions and every session over it go too. The file stays where it is.`,
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    await stDeleteMaterial(m.id);
    if (state.expandedId === m.id) state.expandedId = null;
    state.picked.delete(m.id);
    _emitDataChanged();
  }
  async function deleteSession(s) {
    const ok = await _api.window.showConfirmModal({
      message: `Delete the session ${s.name}?`,
      detail: 'Its answers are already counted toward each concept; only the session record goes.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await stDeleteSession(s.id);
    _emitDataChanged();
  }
  async function deleteBank(b) {
    const ok = await _api.window.showConfirmModal({
      message: `Delete the bank ${b.name}?`,
      detail: `Its ${b.count || 0} questions go with it.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await stDeleteBank(b.id);
    _emitDataChanged();
  }

  // ── Paint ──
  let painting = false, paintQueued = false;
  async function paint() {
    if (painting) { paintQueued = true; return; }
    painting = true;
    try {
      do {
        paintQueued = false;
        await paintOnce();
      } while (paintQueued && !state.disposed);
    } finally { painting = false; }
  }

  async function paintOnce() {
    const now = stNow();
    const materials = (await stListMaterials()) || [];
    const perMaterial = [];
    for (const m of materials) {
      const concepts = (await stListConcepts({ materialIds: [m.id] })) || [];
      const sections = m.kind === 'pdf' && state.expandedId === m.id ? ((await stListSections(m.id)) || []) : [];
      perMaterial.push({ m, concepts, cov: stCoverageOf(concepts, now), sections });
    }
    const open = (await stListSessions({ open: true })) || [];
    const done = (await stListSessions({ open: false })) || [];
    const itemsBySession = new Map();
    for (const s of [...open, ...done]) itemsBySession.set(s.id, (await stListSessionItems(s.id)) || []);
    const banks = (await stListBanks()) || [];
    if (state.disposed) return;

    selectBtn.setAttribute('aria-pressed', state.selecting ? 'true' : 'false');
    selectBtn.classList.toggle('st-sb__btn--on', state.selecting);
    body.innerHTML = '';

    if (!materials.length) {
      _api.ui.createEmptyState(body, {
        icon: 'px-study',
        headline: 'Nothing to study yet.',
        hint: 'Open a PDF and choose Study This Document, or add one here.',
        action: { label: 'Add PDF…', onClick: () => void stAddPdfFlow() },
      });
      return;
    }

    // The pick bar, while selecting.
    if (state.selecting) {
      const bar = el('div', 'st-sb__bar');
      const chosen = perMaterial.filter((p) => state.picked.has(p.m.id));
      const concepts = chosen.reduce((n, p) => n + p.cov.total, 0);
      const weak = chosen.reduce((n, p) => n + p.cov.weak, 0);
      const left = el('div', '');
      left.appendChild(el('b', '', `${chosen.length} ${chosen.length === 1 ? 'material' : 'materials'}`));
      left.appendChild(el('small', '', `${concepts} concepts · ${weak} weak`));
      bar.appendChild(left);
      _api.ui.createButton(bar, {
        label: 'Study Together', kind: 'primary', size: 'sm', disabled: chosen.length === 0,
        title: chosen.length ? 'One session over the picked materials, interleaved.' : 'Pick at least one material.',
        onClick: () => {
          const ids = chosen.map((p) => p.m.id);
          state.selecting = false;
          state.picked.clear();
          stSetPicked([]);
          void paint();
          void stOpenSetup({ materialIds: ids });
        },
      });
      body.appendChild(bar);
    }

    // Materials.
    const matSec = el('div', 'st-sb__sec st-sb__sec--materials');
    sectionLabel(matSec, 'Materials', materials.length);
    for (const p of perMaterial) {
      matSec.appendChild(materialRow(p.m, p.cov, p.concepts));
      if (!state.selecting) for (const s of p.sections) matSec.appendChild(chapterRow(p.m, s, p.concepts, now));
    }
    body.appendChild(matSec);

    // Sessions.
    if (open.length || done.length) {
      const sesSec = el('div', 'st-sb__sec st-sb__sec--sessions');
      sectionLabel(sesSec, 'Sessions', open.length ? `${open.length} open` : null);
      for (const s of open) sesSec.appendChild(sessionRow(s, itemsBySession.get(s.id), now));
      for (const s of done) sesSec.appendChild(sessionRow(s, itemsBySession.get(s.id), now));
      body.appendChild(sesSec);
    }

    // Question banks, folded.
    if (banks.length) {
      const bankSec = el('div', 'st-sb__sec st-sb__sec--banks');
      sectionLabel(bankSec, 'Question banks', banks.length, {
        fold: { open: state.banksOpen, onToggle: () => { state.banksOpen = !state.banksOpen; void paint(); } },
      });
      if (state.banksOpen) for (const b of banks) bankSec.appendChild(bankRow(b));
      body.appendChild(bankSec);
    }
  }

  const offData = onDataChanged(() => void paint());
  const offSession = bus.on('session', () => void paint());
  const offRoute = bus.on('route', (route) => {
    if (!route) return;
    if (Array.isArray(route.materialIds) && route.materialIds.length === 1) state.expandedId = route.materialIds[0];
    if (route.view === 'learn' && route.materialId) state.expandedId = route.materialId;
    state.activeSessionId = route.sessionId != null ? route.sessionId : state.activeSessionId;
    void paint();
  });

  void paint();

  return {
    dispose() {
      state.disposed = true;
      stOff(offData); stOff(offSession); stOff(offRoute);
      root.remove();
    },
  };
}
