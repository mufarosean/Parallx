// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15: A UNIT'S MATERIAL — the pure part
// ═══════════════════════════════════════════════════════════════════════════════
//
// A unit is one place for everything that belongs to it: the canvas pages
// and the workspace files he attached, its questions, and whatever every
// tool that reports progress has for it. What is attached is his, in the
// Units database: a column "Material" (a files column, not kept by Study),
// one entry per item, each { name, src }. A page's src is its link,
// "parallx-page:<id>" (the canvas's own page link); a file in the workspace
// is "parallx-media://workspace/<path>" (the canvas's own link to a file in
// the workspace), so the table shows each by its name and he can add or
// remove one there as in any files cell. What he types there by hand is read
// too: a page link, a file:// URI, a whole path or a path from the
// workspace. Nothing assumes a folder, a parent page or a naming scheme.
// This part is the arithmetic of that, with no database and no DOM:
// reading a cell, adding to it, taking from it, following a file that moved,
// and what Find Matches proposes (the Progress matcher, by name and Also
// Called). 31-unit-material.js reads and writes; 67-unit-view.js draws.

/** The column of Units that holds a unit's material. His: Study writes what he attaches through it, and reads what he types there. */
const ST_UNIT_MATERIAL = 'Material';
/** A page's link, as the canvas writes it (pageLinks.ts). */
const ST_UNIT_PAGE_SCHEME = 'parallx-page:';
/** A file of the workspace, as the canvas's files cells keep one (imageStore.ts). */
const ST_UNIT_FILE_SCHEME = 'parallx-media://workspace/';

const stUnitSlashes = (p) => String(p ?? '').replace(/\\/g, '/');
/** Is this a whole path (from the root of a disk), not one from the workspace? */
const stUnitIsWhole = (p) => /^(\/|[a-zA-Z]:\/)/.test(stUnitSlashes(p));

/** A path from the workspace's folder (forward slashes), or '' when `abs` is not under it. */
function stUnitRelative(abs, root) {
  const a = stUnitSlashes(abs).replace(/\/+$/, '');
  const r = stUnitSlashes(root).replace(/\/+$/, '');
  if (!r || !a) return '';
  const win = /^[a-zA-Z]:\//.test(r);
  const head = win ? a.slice(0, r.length).toLowerCase() : a.slice(0, r.length);
  if (head !== (win ? r.toLowerCase() : r) || a.charAt(r.length) !== '/') return '';
  return a.slice(r.length + 1);
}

/** The link a cell keeps for a page. */
function stUnitPageSrc(pageId) {
  return `${ST_UNIT_PAGE_SCHEME}${pageId}`;
}

/** The link a cell keeps for a file at `rel` in the workspace. */
function stUnitFileSrc(rel) {
  return ST_UNIT_FILE_SCHEME + stUnitSlashes(rel).split('/').map(encodeURIComponent).join('/');
}

const stUnitBase = (p) => stUnitSlashes(p).split('/').filter(Boolean).pop() || '';

/**
 * One entry of a Material cell, as what it points at: { kind: 'page', id,
 * name } or { kind: 'file', rel, abs, name } (`rel` its path in the
 * workspace, '' when it is outside it; `abs` its whole path, '' when only
 * `rel` is known), or null for what points at nothing Study can open (a web
 * link, an empty entry). `root` is the workspace folder's path.
 */
function stUnitParse(entry, root = '') {
  let src = '';
  let name = '';
  if (typeof entry === 'string') src = entry.trim();
  else if (entry && typeof entry === 'object') { src = String(entry.src ?? entry.url ?? entry.path ?? '').trim(); name = String(entry.name ?? entry.title ?? '').trim(); }
  if (!src) return null;
  const page = /^(?:parallx-page:|parallx:\/\/canvas\/page\/)([A-Za-z0-9_-]{1,64})(?:#.*)?$/.exec(src);
  if (page) return { kind: 'page', id: page[1], name };
  let rel = '';
  let abs = '';
  if (src.startsWith(ST_UNIT_FILE_SCHEME)) {
    try { rel = src.slice(ST_UNIT_FILE_SCHEME.length).split('/').map(decodeURIComponent).join('/'); } catch { rel = src.slice(ST_UNIT_FILE_SCHEME.length); }
  } else if (/^file:\/\//i.test(src)) {
    let p = src.replace(/^file:\/\//i, '');
    try { p = decodeURIComponent(p); } catch { /* as written */ }
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    abs = stUnitSlashes(p);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) {
    return null;
  } else if (stUnitIsWhole(src)) {
    abs = stUnitSlashes(src);
  } else {
    rel = stUnitSlashes(src).replace(/^\.\//, '');
  }
  if (abs && !rel) rel = stUnitRelative(abs, root);
  if (!rel && !abs) return null;
  return { kind: 'file', rel, abs, name: name || stUnitBase(rel || abs) };
}

/** What an item is known by, the same however it was written: "page:<id>", "file:<path in the workspace>" (or its whole path). */
function stUnitKey(item) {
  if (!item) return '';
  if (item.kind === 'page') return `page:${item.id}`;
  return `file:${item.rel || item.abs}`;
}

/** A cell's value as its entries: an array, or text listing them (a comma, a semicolon or a new line between). */
function stUnitEntriesOf(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/\s*[\n;,]\s*/).filter(Boolean);
  return [value];
}

/** A unit's material: what each entry of its cell points at, once each, in the cell's order. */
function stUnitItems(value, root = '') {
  const out = [];
  const seen = new Set();
  for (const entry of stUnitEntriesOf(value)) {
    const item = stUnitParse(entry, root);
    const key = stUnitKey(item);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, key });
  }
  return out;
}

/** The entry Study writes for an item: { name, src }. A file outside the workspace keeps its file:// link. */
function stUnitEntry(item) {
  if (item.kind === 'page') return { name: String(item.name || 'Untitled'), src: stUnitPageSrc(item.id) };
  const src = item.rel ? stUnitFileSrc(item.rel) : `file://${stUnitSlashes(item.abs).startsWith('/') ? '' : '/'}${encodeURI(stUnitSlashes(item.abs))}`;
  return { name: String(item.name || stUnitBase(item.rel || item.abs)), src };
}

/** The cell as an array of entries, as the files column takes them (what he typed is kept as he typed it). */
function stUnitCellArray(value) {
  return stUnitEntriesOf(value).map((e) => (typeof e === 'string' ? { name: stUnitBase(e) || e, src: e } : e));
}

/** The cell with `items` added at its end; one already there is not added again. Null when nothing is added. */
function stUnitAdd(value, items, root = '') {
  const have = new Set(stUnitItems(value, root).map((i) => i.key));
  const add = [];
  for (const item of items || []) {
    const key = stUnitKey(item);
    if (!key || have.has(key)) continue;
    have.add(key);
    add.push(stUnitEntry(item));
  }
  return add.length ? [...stUnitCellArray(value), ...add] : null;
}

/** The cell without the entries that point at `key`. Null when none does. */
function stUnitRemove(value, key, root = '') {
  const list = stUnitCellArray(value);
  const kept = list.filter((e) => stUnitKey(stUnitParse(e, root)) !== key);
  return kept.length === list.length ? null : kept;
}

/**
 * The cell after a file or folder at `from` moved to `to` (both paths in the
 * workspace): each entry for it, or under it, points at the new place under
 * its new name. Null when no entry is touched.
 */
function stUnitMoved(value, from, to, root = '') {
  const f = stUnitSlashes(from).replace(/\/+$/, '');
  const t = stUnitSlashes(to).replace(/\/+$/, '');
  if (!f || !t || f === t) return null;
  let touched = false;
  const out = stUnitCellArray(value).map((e) => {
    const item = stUnitParse(e, root);
    if (!item || item.kind !== 'file' || !item.rel) return e;
    if (item.rel !== f && !item.rel.startsWith(`${f}/`)) return e;
    touched = true;
    const rel = t + item.rel.slice(f.length);
    // A name he gave it stays, unless it was the file's own name.
    const own = !item.name || item.name === stUnitBase(item.rel);
    return stUnitEntry({ kind: 'file', rel, abs: '', name: own ? stUnitBase(rel) : item.name });
  });
  return touched ? out : null;
}

/** The cell with each page entry named as the page is titled now (`titleOf(id)`, undefined when not known). Null when every name is right. */
function stUnitRetitled(value, titleOf, root = '') {
  let touched = false;
  const out = stUnitCellArray(value).map((e) => {
    const item = stUnitParse(e, root);
    if (!item || item.kind !== 'page' || typeof e !== 'object') return e;
    const now = titleOf(item.id);
    if (typeof now !== 'string' || !now || now === item.name) return e;
    touched = true;
    return { ...e, name: now };
  });
  return touched ? out : null;
}

/** A file's name without its last extension: what Find Matches compares with a unit's names. */
function stUnitStem(name) {
  const n = String(name ?? '');
  const at = n.lastIndexOf('.');
  return at > 0 ? n.slice(0, at) : n;
}

/**
 * What Find Matches proposes: every candidate whose title (a page) or name
 * without its extension (a file) is a unit's name or one of its Also Called,
 * as Progress matches a tool's groups (stProgressMatch: case, spaces,
 * punctuation and accents aside). `units` are [{ name, also, attached: Set
 * of keys }] in the Units order; `candidates` are [{ key, label, ... }].
 * Returns [{ unit, candidate }] in the units' order, then the candidates'.
 * What a unit has already is not proposed for it.
 */
function stUnitProposals(units, candidates) {
  const list = Array.isArray(units) ? units : [];
  const groups = (candidates || []).map((c, i) => ({ group: String(i), label: c.label, candidate: c }));
  const m = stProgressMatch(list.map((u) => ({ name: u.name, also: u.also })), groups);
  const out = [];
  m.matched.forEach((gs, i) => {
    const unit = list[i];
    for (const g of gs) if (!(unit.attached && unit.attached.has(g.candidate.key))) out.push({ unit: unit.name, candidate: g.candidate });
  });
  return out;
}

/** Where a page lives: the titles of the pages above it, nearest last ("Reading Log", "Course › Week 3"); '' at the top. */
function stUnitPageWhere(id, byId) {
  const names = [];
  const seen = new Set([id]);
  let at = byId.get(id);
  while (at && at.parentId && !seen.has(at.parentId)) {
    seen.add(at.parentId);
    const up = byId.get(at.parentId);
    if (!up) break;
    names.unshift(String(up.title || 'Untitled'));
    at = up;
  }
  return names.join(' › ');
}

/** Where a file lives: its folders from the workspace ("Readings › Week 1"); '' at the root; its whole folder when outside. */
function stUnitFileWhere(item) {
  const p = item.rel || item.abs;
  const parts = stUnitSlashes(p).split('/').filter(Boolean);
  parts.pop();
  return item.rel ? parts.join(' › ') : `${stUnitIsWhole(p) && !p.startsWith('/') ? '' : '/'}${parts.join('/')}`;
}

/** The kind an icon is chosen by: a page, a PDF, a picture, text, or any other file. */
function stUnitKindOf(item) {
  if (item.kind === 'page') return 'page';
  const ext = (/\.([^./]+)$/.exec(String(item.rel || item.abs || item.name)) || [])[1] || '';
  const e = ext.toLowerCase();
  if (e === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(e)) return 'image';
  if (['md', 'markdown', 'txt', 'text'].includes(e)) return 'text';
  return 'file';
}

/** A count in his words: "3 right · 1 partly · 2 wrong · 2 not yet". */
function stUnitCountsLine(counts, words) {
  return ST_PROGRESS_STATES.map((s, i) => `${counts[i]} ${stProgressWord(words, s)}`).join(' · ');
}
