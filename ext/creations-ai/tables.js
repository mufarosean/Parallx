// tables.js — Creations AI: Tables.
//
// A rail of table files (Perchance list grammar, tables-core.js) and, for
// the open one, the source in a monospace editor with its parse errors
// under it, a Roll control (how many, which list) and the results, each
// with Copy and Reroll. Autosaves. `attachTableRoll` is the small "Roll A
// Table" control the Studio and the Story Writer put beside a text field
// to drop a roll into it. Design and gates: docs/CREATIONS_AI.md, slice 4.

import { injectStudioStyles } from './studio.js';
import { parseTables, evaluate, roll, listNames, STARTER_TABLE } from './tables-core.js';

const STYLE_ID = 'creations-tables-styles';
const AUTOSAVE_MS = 800;
const TABLES_DIR = 'tables';
const COUNTS = [1, 5, 10, 20];

export function injectTablesStyles() {
  injectStudioStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.tb-name { flex: 1; min-width: 0; font-size: var(--px-text-xl); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-editor { width: 100%; box-sizing: border-box; min-height: 260px; font-family: var(--px-font-mono); font-size: var(--px-text-sm); line-height: 1.5; background: var(--px-bg-inset); border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); color: var(--px-text); padding: var(--px-space-3); resize: vertical; white-space: pre; overflow: auto; tab-size: 2; }
.tb-editor:focus { outline: none; border-color: var(--px-accent); }
.tb-controls { display: flex; align-items: center; gap: var(--px-space-2); flex-wrap: wrap; font-size: var(--px-text-sm); color: var(--px-text-muted); }
.tb-results { display: flex; flex-direction: column; }
.tb-result { display: flex; align-items: flex-start; gap: var(--px-space-2); padding: var(--px-space-2) 0; border-bottom: 1px solid var(--px-divider); font-size: var(--px-text-md); line-height: 1.5; }
.tb-result-text { flex: 1; min-width: 0; white-space: pre-wrap; }
.tb-result-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .12s; }
.tb-result:hover .tb-result-actions, .tb-result:focus-within .tb-result-actions { opacity: 1; }
.tb-roll { display: inline-flex; align-items: center; }
`;
  document.head.appendChild(style);
}

// ── Storage ────────────────────────────────────────────────────────────────

const tableName = (fileName) => fileName.replace(/\.txt$/, '');

export async function listTables(fs, workspaceUri, deps) {
  const dir = deps.resolveUri(workspaceUri, `${deps.extRoot}/${TABLES_DIR}`);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.type === 1 && e.name.endsWith('.txt')).map((e) => ({ fileName: e.name, name: tableName(e.name) })).sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function readTable(fs, workspaceUri, deps, name) {
  try {
    const { content } = await fs.readFile(deps.resolveUri(workspaceUri, `${deps.extRoot}/${TABLES_DIR}/${name}.txt`));
    return String(content);
  } catch { return null; }
}

async function writeTable(fs, workspaceUri, deps, name, source) {
  await deps.ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', deps.extFolder, TABLES_DIR]);
  await fs.writeFile(deps.resolveUri(workspaceUri, `${deps.extRoot}/${TABLES_DIR}/${name}.txt`), source);
}

/**
 * Parse a table and fetch every table it imports (and those they import),
 * so evaluation can resolve `{import:name}` without touching the disk.
 */
export async function loadTable(fs, workspaceUri, deps, source) {
  const gen = parseTables(source);
  const loaded = new Map();
  const queue = [...gen.imports.values()];
  const errors = [...gen.errors];
  let guard = 0;
  while (queue.length && guard++ < 40) {
    const name = queue.shift();
    if (loaded.has(name)) continue;
    const src = await readTable(fs, workspaceUri, deps, name);
    if (src == null) { loaded.set(name, null); errors.push(`The table "${name}" could not be found`); continue; }
    const sub = parseTables(src);
    loaded.set(name, sub);
    for (const n of sub.imports.values()) if (!loaded.has(n)) queue.push(n);
  }
  return { gen, imports: (name) => loaded.get(name) || null, errors };
}

function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'table';
}

// ── The page: rail + pane ──────────────────────────────────────────────────

export function renderTablesPage(container, parallx, input, deps) {
  deps.injectStyles?.();
  injectTablesStyles();
  const { el, icon } = deps;
  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  const rawInstance = (input && (input.instanceId || input.id)) || '';
  const root = el('div', 'tg-cc');
  container.appendChild(root);
  if (!fs || !workspaceUri) {
    root.appendChild(el('div', 'tg-empty', { text: 'Open a workspace to keep tables.' }));
    return { dispose() { container.innerHTML = ''; } };
  }
  const rail = el('div', 'tg-cc-rail');
  const head = el('div', 'tg-cc-rail-head');
  head.appendChild(el('span', 'tg-cc-rail-title', { text: 'Tables' }));
  const newBtn = el('button', 'tg-cc-rail-add', { html: icon('plus', 14) });
  newBtn.title = 'New Table';
  head.appendChild(newBtn);
  rail.appendChild(head);
  const list = el('div', 'tg-cc-list');
  rail.appendChild(list);
  const pane = el('div', 'tg-cc-pane');
  root.append(rail, pane);

  let selected = null;
  let paneEditor = null;
  const rowByName = new Map();
  const clearPane = () => { if (paneEditor) { try { paneEditor.dispose?.(); } catch { /* gone */ } paneEditor = null; } pane.innerHTML = ''; };
  const markActive = () => { for (const [n, row] of rowByName) row.classList.toggle('tg-cc-row--active', n === selected); };

  async function refreshRail() {
    list.innerHTML = '';
    rowByName.clear();
    const tables = await listTables(fs, workspaceUri, deps);
    if (tables.length === 0) list.appendChild(el('div', 'tg-cc-list-empty', { text: 'No tables yet.' }));
    for (const t of tables) {
      const row = el('div', 'tg-cc-row');
      rowByName.set(t.name, row);
      row.appendChild(el('span', 'tg-cc-row-icon', { html: icon('dices', 14) }));
      row.appendChild(el('span', 'tg-cc-row-name', { text: t.name }));
      const acts = el('span', 'tg-cc-row-actions');
      const del = el('button', 'tg-cc-row-action tg-cc-row-action--danger', { html: icon('trash', 12) });
      del.title = 'Delete';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        const choice = await parallx.window.showWarningMessage(`Delete the table "${t.name}"? This cannot be undone.`, { title: 'Delete' });
        if (!choice || choice.title !== 'Delete') return;
        if (selected === t.name) { try { paneEditor?.abandon?.(); } catch { /* gone */ } }
        try { await fs.delete(deps.resolveUri(workspaceUri, `${deps.extRoot}/${TABLES_DIR}/${t.fileName}`)); } catch { /* already gone */ }
        if (selected === t.name) { selected = null; clearPane(); showEmpty(); }
        await refreshRail();
      });
      acts.appendChild(del);
      row.appendChild(acts);
      row.addEventListener('click', () => open(t.name));
      list.appendChild(row);
    }
    markActive();
  }
  function showEmpty() {
    const empty = el('div', 'tg-cc-empty');
    empty.appendChild(el('div', null, { html: icon('dices', 32) }));
    empty.appendChild(el('div', null, { text: 'Pick a table, or make a new one.' }));
    pane.appendChild(empty);
  }
  function open(name) {
    if (selected === name && paneEditor) return;
    clearPane();
    selected = name;
    markActive();
    paneEditor = renderTablePane(pane, parallx, { fs, workspaceUri, name }, deps);
  }
  async function createTable() {
    let name = null;
    try { name = await parallx.window.showInputBox({ prompt: 'A name for the table', placeholder: 'names' }); } catch { name = null; }
    if (!name || !name.trim()) return;
    let base = slug(name);
    const existing = new Set((await listTables(fs, workspaceUri, deps)).map((t) => t.name));
    let final = base;
    let i = 2;
    while (existing.has(final)) final = `${base}-${i++}`;
    await writeTable(fs, workspaceUri, deps, final, STARTER_TABLE);
    await refreshRail();
    open(final);
  }
  newBtn.addEventListener('click', () => void createTable());
  refreshRail().then(() => {
    if (rawInstance === 'new') void createTable();
    else if (rawInstance && rawInstance !== 'tables') open(tableName(rawInstance));
    else showEmpty();
  }).catch((err) => console.warn('[Creations] Tables rail failed:', err));
  return { dispose() { clearPane(); container.innerHTML = ''; } };
}

// ── The pane ───────────────────────────────────────────────────────────────

export function renderTablePane(container, parallx, ctx, deps) {
  injectTablesStyles();
  const { el, icon, tgSelect } = deps;
  const { fs, workspaceUri, name } = ctx;
  const root = el('div', 'cs');
  container.appendChild(root);
  const state = { source: '', dirty: false, saveTimer: null, disposed: false, count: 5, list: 'output', rolling: false };

  const bar = el('div', 'cs-bar');
  bar.appendChild(el('div', 'tb-name', { text: name }));
  const status = el('span', 'cs-chip cs-chip--ok', { text: 'Saved' });
  bar.appendChild(status);
  root.appendChild(bar);

  const editorSec = section('Source', 'Lists, one per block. Indent the items. The first list, or output, is what rolls.');
  root.appendChild(editorSec.root);
  const editor = el('textarea', 'tb-editor');
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'Table source');
  editor.addEventListener('input', () => { state.source = editor.value; state.dirty = true; scheduleSave(); refreshLists(); });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart, t = editor.selectionEnd;
      editor.value = `${editor.value.slice(0, s)}  ${editor.value.slice(t)}`;
      editor.selectionStart = editor.selectionEnd = s + 2;
      editor.dispatchEvent(new Event('input'));
    }
  });
  const errors = el('div', 'cs-error');
  errors.style.display = 'none';
  editorSec.body.append(editor, errors);

  const rollSec = section('Roll', '');
  root.appendChild(rollSec.root);
  const controls = el('div', 'tb-controls');
  const rollBtn = button('Roll', 'dices', () => void doRoll(), true);
  const countSel = tgSelect(parallx, { layout: 'inline', title: 'How many results', items: COUNTS.map((n) => ({ value: String(n), label: `${n}` })), value: '5', onChange: (v) => { state.count = Number(v) || 5; } });
  const listSel = tgSelect(parallx, { layout: 'inline', title: 'Which list to roll', items: [{ value: 'output', label: 'output' }], value: 'output', onChange: (v) => { state.list = v || 'output'; } });
  controls.append(rollBtn, el('span', null, { text: 'times' }), countSel.element, el('span', null, { text: 'from' }), listSel.element);
  const results = el('div', 'tb-results');
  rollSec.body.append(controls, results);

  function button(label, iconName, onClick, primary = false) {
    const b = el('button', `cs-btn${primary ? ' cs-btn--primary' : ''}`, { html: `${icon(iconName, 14)}<span>${label}</span>` });
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return b;
  }
  function iconButton(iconName, hint, onClick) {
    const b = el('button', 'cs-icon-btn', { html: icon(iconName, 14) });
    b.title = hint;
    b.setAttribute('aria-label', hint);
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return b;
  }
  function section(title, meta) {
    const sroot = el('div', 'cs-section');
    const shead = el('div', 'cs-section-head');
    const m = el('span', 'cs-section-meta', { text: meta });
    shead.append(el('span', 'cs-section-chev', { html: icon('chevron-down', 14) }), el('span', 'cs-section-title', { text: title }), m);
    const body = el('div', 'cs-section-body');
    sroot.append(shead, body);
    shead.addEventListener('click', () => sroot.classList.toggle('cs-section--closed'));
    return { root: sroot, body, setMeta: (t) => { m.textContent = t; } };
  }
  function showErrors(list) {
    if (!list.length) { errors.style.display = 'none'; errors.textContent = ''; return; }
    errors.textContent = list.join(' · ');
    errors.style.display = '';
  }
  function refreshLists() {
    const gen = parseTables(state.source);
    const names = listNames(gen);
    listSel.setItems((names.length ? names : ['output']).map((n) => ({ value: n, label: n })));
    if (!names.includes(state.list)) { state.list = names[0] || 'output'; listSel.value = state.list; }
    showErrors(gen.errors);
  }
  async function doRoll() {
    if (state.rolling) return;
    state.rolling = true;
    rollBtn.disabled = true;
    try {
      const loaded = await loadTable(fs, workspaceUri, deps, state.source);
      const r = roll(loaded.gen, state.count, state.list, { imports: loaded.imports });
      showErrors([...loaded.errors, ...r.errors]);
      results.replaceChildren(...r.results.map((text) => resultRow(text, loaded)));
      rollSec.setMeta(`${r.results.length} ${r.results.length === 1 ? 'result' : 'results'} from ${state.list}`);
    } finally {
      state.rolling = false;
      rollBtn.disabled = false;
    }
  }
  function resultRow(text, loaded) {
    const row = el('div', 'tb-result');
    const t = el('span', 'tb-result-text', { text });
    const acts = el('div', 'tb-result-actions');
    acts.appendChild(iconButton('copy', 'Copy this result', () => { try { void navigator.clipboard?.writeText(t.textContent || ''); } catch { /* no clipboard */ } }));
    acts.appendChild(iconButton('refresh-cw', 'Roll this one again', () => {
      const r = evaluate(loaded.gen, state.list, { imports: loaded.imports });
      t.textContent = r.text;
      if (r.errors.length) showErrors(r.errors);
    }));
    row.append(t, acts);
    return row;
  }
  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    status.textContent = 'Saving';
    status.className = 'cs-chip';
    state.saveTimer = setTimeout(() => { state.saveTimer = null; void save(); }, AUTOSAVE_MS);
  }
  async function save() {
    if (!state.dirty) return;
    try {
      await writeTable(fs, workspaceUri, deps, name, state.source);
      state.dirty = false;
      status.textContent = 'Saved';
      status.className = 'cs-chip cs-chip--ok';
    } catch (err) {
      status.textContent = 'Could Not Save';
      status.className = 'cs-chip cs-chip--danger';
      console.warn('[Creations] table save failed:', err);
    }
  }
  async function load() {
    const src = await readTable(fs, workspaceUri, deps, name);
    if (state.disposed) return;
    state.source = src == null ? STARTER_TABLE : src;
    editor.value = state.source;
    refreshLists();
    await doRoll();
  }
  void load();
  return {
    /** Forget unsaved edits: the file is being deleted, nothing must write it back. */
    abandon() {
      state.dirty = false;
      if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    },
    dispose() {
      state.disposed = true;
      if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
      if (state.dirty) void save();
      root.remove();
    },
    __state: state,
  };
}

// ── Roll A Table, beside a text field ──────────────────────────────────────

/**
 * A small control that lists the tables and drops one roll of the chosen
 * table's output into `textarea`. Returns the element to place.
 */
export function attachTableRoll(parallx, deps, fs, workspaceUri, textarea) {
  injectTablesStyles();
  const { el, tgSelect } = deps;
  const host = el('span', 'tb-roll');
  const sel = tgSelect(parallx, { layout: 'inline', title: 'Drop one roll of a table into this field', items: [{ value: '', label: 'Roll A Table' }], value: '', onChange: (v) => { if (v) void insert(v); } });
  host.appendChild(sel.element);
  let loaded = false;
  async function refresh() {
    const tables = await listTables(fs, workspaceUri, deps);
    sel.setItems([{ value: '', label: tables.length ? 'Roll A Table' : 'No Tables Yet' }, ...tables.map((t) => ({ value: t.name, label: t.name }))]);
    sel.value = '';
    loaded = true;
  }
  async function insert(name) {
    sel.value = '';
    const src = await readTable(fs, workspaceUri, deps, name);
    if (src == null) return;
    const table = await loadTable(fs, workspaceUri, deps, src);
    const r = evaluate(table.gen, 'output', { imports: table.imports });
    if (!r.text) return;
    const current = textarea.value || '';
    textarea.value = current.trim() ? `${current.replace(/\s+$/, '')} ${r.text}` : r.text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }
  host.addEventListener('mouseenter', () => { if (!loaded) void refresh(); });
  host.addEventListener('focusin', () => { if (!loaded) void refresh(); });
  void refresh();
  return host;
}
