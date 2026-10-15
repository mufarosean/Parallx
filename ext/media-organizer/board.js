// board.js — a painting plan's board: an endless surface where the plan's
// variations, palettes, pinned mixes, library photos, notes, frames and
// arrows are laid out by hand, moved, resized and grouped (docs: the design
// canvas "Painting Board"). One board per plan, kept in
// mo_plan_boards as JSON. Cards are live: a variation card is rendered from
// its recipe, a palette card from that variation's colours, a mix card from
// the painter's paints and rules as they are now.
//
// Every action is a command (media-organizer.board.*) run on the board in
// use, so the toolbar, the menus, the palette and the assistant share them.
// Pointer, finger and keys all work: drag a card or Tab to it and use the
// arrows (Alt+arrows resize), Delete removes, Enter opens.

import { moEl } from './dom.js';
import { moBoxKeys } from './keys.js';
import { moColourName, moMixRecipes, moValueSwatches } from './colour.js';
import { moPlanPaintSet } from './plan-colours.js';
import { KIND_NAME, moBoardLoad, moBoardSave, normalize } from './board-data.js';

const ACTIONS = ['select', 'pan', 'arrowTool', 'addPhoto', 'pickPhoto', 'addVariation', 'addPalette', 'addNote', 'addFrame',
  'zoomIn', 'zoomOut', 'fit', 'openPlan', 'paletteFromThis', 'bringToFront', 'lock', 'removeSelected', 'openSwatch', 'pinMix',
  'copyRecipe', 'exportImage', 'exportMenu', 'closePopover'];
const open = new Set();
let lastUsed = null;
const boardInUse = () => [...open].find((b) => b.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
const hexOf = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// A variation saved on Values is its values; one saved on Colour or Photo is its colours and the mixes picked from it.
const colourList = (recipe) => recipe && recipe.show === 'values' ? moValueSwatches(recipe.levels, recipe.notan, recipe.under) : [...((recipe && recipe.palette && recipe.palette.swatches) || []), ...((recipe && recipe.saved) || []).map((c) => c.rgb)].filter((c) => Array.isArray(c));
const stageText = (r) => [r.blur > 0 ? `Squint ${Math.round(r.blur * 100)}%` : '', r.notan > 0 ? 'Notan' : r.levels >= 2 ? `${r.levels} values` : 'All values', r.grey ? 'grey' : ''].filter(Boolean).join(' · ');

export function moBoardActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.board.${a}`, (...args) => { const b = boardInUse(); return b ? b.act(a, ...args) : undefined; }));
}

// ── The board ──────────────────────────────────────────────────────────────

/**
 * ctx: { api, db, planId, loadPlan() -> { plan, variants: [{ id, name, recipe }] },
 *   renderVariant(recipe, maxSide) -> Promise<dataURL>, thumb(img, photoId),
 *   searchPhotos(text) -> Promise<[{ id, title }]>, openPlan(), sourcePath(), ingest(path),
 *   getSetting, setSetting }
 */
export function moRenderBoard(container, ctx) {
  const { api } = ctx;
  const ui = api.ui;
  const io = { getSetting: ctx.getSetting, setSetting: ctx.setSetting };
  const root = moEl('div', 'mo-bd');
  root.tabIndex = -1;
  container.appendChild(root);
  let disposed = false;
  let board = normalize(null);
  let plan = null, variants = [];
  let paints = null;
  const sel = new Set();
  let tool = 'select';
  let arrowFrom = null;
  const history = []; let hIdx = -1;
  let saveTimer = 0;
  const els = new Map();      // item id -> element
  const renders = new Map();  // variation id -> { key, url }
  const subs = [];

  // ── chrome ──
  const header = moEl('div', 'mo-bd-header');
  const title = moEl('div', 'mo-bd-title');
  const count = moEl('div', 'mo-practice-dim');
  const headRight = moEl('div', 'mo-bd-head-right');
  header.append(title, count, headRight);
  ui.createButton(headRight, { id: 'media-organizer.board.openPlan', label: 'Open Plan', size: 'sm', command: 'media-organizer.board.openPlan' });
  const exportBtn = ui.createButton(headRight, { id: 'media-organizer.board.exportMenu', label: 'Export', icon: 'image-up', size: 'sm', title: 'Save the board to the library, or export it as a file', command: 'media-organizer.board.exportMenu' });
  exportBtn.setAttribute('aria-haspopup', 'menu');
  const view = moEl('div', 'mo-bd-view', { role: 'region', 'aria-label': 'Board. Tab moves between cards; arrow keys move a card, Alt and arrows resize it, Delete removes it.' });
  const world = moEl('div', 'mo-bd-world');
  const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  links.setAttribute('class', 'mo-bd-links'); links.setAttribute('aria-hidden', 'true');
  world.appendChild(links);
  const overlay = moEl('div', 'mo-bd-overlay');
  const toolbar = moEl('div', 'mo-bd-toolbar', { role: 'toolbar', 'aria-label': 'Board tools' });
  const toolBtn = (id, label, icon, args) => { const b = ui.createButton(toolbar, { id: `media-organizer.board.tool.${id}`, label, icon, size: 'sm', kind: 'ghost', command: `media-organizer.board.${id}`, args }); return b; };
  const tSelect = toolBtn('select', 'Select', 'mouse-pointer-2');
  const tPan = toolBtn('pan', 'Move View', 'hand');
  toolbar.appendChild(moEl('span', 'mo-bd-sep', { 'aria-hidden': 'true' }));
  const tPhoto = toolBtn('addPhoto', 'Photo', 'image-plus');
  const tVariation = toolBtn('addVariation', 'Variation', 'layers');
  const tPalette = toolBtn('addPalette', 'Palette', 'palette');
  toolBtn('addNote', 'Note', 'sticky-note');
  toolBtn('addFrame', 'Frame', 'square-dashed');
  const tArrow = toolBtn('arrowTool', 'Arrow', 'move-up-right');
  for (const b of [tVariation, tPalette]) b.setAttribute('aria-haspopup', 'menu');
  tPhoto.setAttribute('aria-haspopup', 'dialog');
  const zoomBar = moEl('div', 'mo-bd-zoom', { role: 'group', 'aria-label': 'Zoom' });
  ui.createIconButton(zoomBar, { id: 'media-organizer.board.zoomOut', icon: 'minus', title: 'Zoom Out', size: 'sm', command: 'media-organizer.board.zoomOut' });
  const zoomLabel = moEl('span', 'mo-bd-zoom-label', { 'aria-live': 'polite' });
  zoomBar.appendChild(zoomLabel);
  ui.createIconButton(zoomBar, { id: 'media-organizer.board.zoomIn', icon: 'plus', title: 'Zoom In', size: 'sm', command: 'media-organizer.board.zoomIn' });
  ui.createButton(zoomBar, { id: 'media-organizer.board.fit', label: 'Fit', size: 'sm', kind: 'ghost', command: 'media-organizer.board.fit' });
  const mini = moEl('canvas', 'mo-bd-mini', { 'aria-hidden': 'true', width: '168', height: '104' });
  const live = moEl('div', 'mo-pc-live', { 'aria-live': 'polite' });
  view.append(toolbar, world, overlay, zoomBar, mini, live);
  root.append(header, view);
  const empty = moEl('div', 'mo-bd-empty');
  empty.append(moEl('div', 'mo-pc-name', { textContent: 'An empty board' }), moEl('div', 'mo-practice-dim', { textContent: 'Add the plan’s variations and palettes from the toolbar, or from the plan with Add To Board. Photos come from the library.' }));
  view.appendChild(empty);

  // ── history and saving ──
  const snap = () => JSON.stringify(board.items);
  function commit() {
    const s = snap();
    if (history[hIdx] === s) return;
    history.splice(hIdx + 1); history.push(s);
    if (history.length > 60) history.shift();
    hIdx = history.length - 1;
    scheduleSave();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (!disposed) void moBoardSave(ctx.db, ctx.planId, board).catch(() => {}); }, 400);
  }
  function restore(i) { board.items = JSON.parse(history[i]); hIdx = i; sel.clear(); renderAll(); scheduleSave(); }

  // ── view ──
  function applyView() {
    const v = board.view;
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    view.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
    view.style.backgroundPosition = `${v.x}px ${v.y}px`;
    zoomLabel.textContent = `${Math.round(v.z * 100)}%`;
    drawOverlay(); drawMini();
  }
  function zoomAt(f, cx, cy) {
    const v = board.view, z = clamp(v.z * f, 0.1, 4);
    const k = z / v.z;
    v.x = cx - (cx - v.x) * k; v.y = cy - (cy - v.y) * k; v.z = z; v.set = true;
    applyView(); scheduleSave();
  }
  function bounds(items) {
    if (!items.length) return null;
    const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
    return { x: x0, y: y0, w: Math.max(...items.map((i) => i.x + i.w)) - x0, h: Math.max(...items.map((i) => i.y + i.h)) - y0 };
  }
  function fit() {
    const b = bounds(board.items.filter((i) => i.kind !== 'arrow'));
    if (!b) return;
    const W = view.clientWidth, H = view.clientHeight;
    const z = clamp(Math.min((W - 120) / b.w, (H - 160) / b.h), 0.1, 2);
    board.view = { z, x: (W - b.w * z) / 2 - b.x * z, y: (H - b.h * z) / 2 - b.y * z + 20, set: true };
    applyView(); scheduleSave();
  }
  const toWorld = (cx, cy) => { const r = view.getBoundingClientRect(), v = board.view; return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }; };
  const toScreen = (x, y) => ({ x: x * board.view.z + board.view.x, y: y * board.view.z + board.view.y });
  function centreSpot(w, h) {
    const r = view.getBoundingClientRect(), c = toWorld(r.left + view.clientWidth / 2, r.top + view.clientHeight / 2);
    const a = toWorld(r.left + 16, r.top + 56), b = toWorld(r.right - 16, r.bottom - 16); // clear of the toolbar
    const hits = (p) => board.items.some((i) => i.kind !== 'arrow' && i.kind !== 'frame' && p.x < i.x + i.w + 24 && p.x + w + 24 > i.x && p.y < i.y + i.h + 24 && p.y + h + 24 > i.y);
    const seen = (p) => p.x >= a.x && p.y >= a.y && p.x + w <= b.x && p.y + h <= b.y;
    const spots = [];
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) spots.push({ x: Math.round(c.x - w / 2 + i * (w / 2 + 12)), y: Math.round(c.y - h / 2 + j * (h / 2 + 12)), d: i * i * (w * w) + j * j * (h * h) });
    spots.sort((p, q) => p.d - q.d);
    return spots.find((p) => !hits(p) && seen(p)) || spots.find((p) => !hits(p)) || spots[0];
  }
  // A card off screen is brought into view (a new one where there was no room on screen).
  function reveal(it) {
    const s = toScreen(it.x, it.y), W = view.clientWidth, H = view.clientHeight, w = it.w * board.view.z, h = it.h * board.view.z;
    if (s.x >= 0 && s.y >= 48 && s.x + w <= W && s.y + h <= H) return;
    board.view.x = W / 2 - (it.x + it.w / 2) * board.view.z; board.view.y = H / 2 - (it.y + it.h / 2) * board.view.z; board.view.set = true;
    applyView(); scheduleSave();
  }

  // ── cards ──
  const byId = (id) => board.items.find((i) => i.id === id);
  const variantOf = (id) => variants.find((v) => v.id === id) || null;
  const aspect = () => (plan && plan.canvas_w > 0 && plan.canvas_h > 0 ? plan.canvas_w / plan.canvas_h : 0.8);
  function labelOf(it) {
    if (it.kind === 'variation' || it.kind === 'palette') { const v = variantOf(it.variantId); return `${KIND_NAME[it.kind]}: ${v ? v.name : 'a removed variation'}`; }
    if (it.kind === 'mix') return `Mix: ${moColourName(it.rgb).name}`;
    if (it.kind === 'photo') return `Photo: ${it.title || 'from the library'}`;
    if (it.kind === 'frame') return `Frame: ${it.title || 'Frame'}`;
    if (it.kind === 'note') return 'Note';
    return KIND_NAME[it.kind];
  }
  function buildCard(it) {
    const el = moEl('div', `mo-bd-item mo-bd-item--${it.kind}`);
    el.dataset.id = String(it.id);
    fillCard(el, it);
    disposersOf(el).push(moBoxKeys(el, labelOf(it), {
      nudge: (dx, dy, size) => { const c = byId(it.id); if (!c || c.locked) return; if (size) { c.w = Math.max(40, c.w + dx * 8); c.h = Math.max(30, c.h + dy * 8); keepAspect(c, 'w'); } else { c.x += dx * 8; c.y += dy * 8; } place(c); drawLinks(); drawOverlay(); },
      commit: () => commit(),
    }));
    el.setAttribute('aria-label', labelOf(it));
    const onFocus = () => { if (!sel.has(it.id)) { sel.clear(); sel.add(it.id); drawOverlay(); } };
    el.addEventListener('focus', onFocus);
    return el;
  }
  const cardDisposers = new WeakMap();
  const disposersOf = (el) => { if (!cardDisposers.has(el)) cardDisposers.set(el, []); return cardDisposers.get(el); };
  function keepAspect(c, by) {
    if (c.kind !== 'variation' && c.kind !== 'photo') return;
    const a = c.aspect || (c.kind === 'variation' ? aspect() : 1);
    const cap = c.kind === 'variation' ? 44 : 40;
    if (by === 'w') c.h = Math.round(c.w / a + cap); else c.w = Math.round((c.h - cap) * a);
  }
  function fillCard(el, it) {
    el.replaceChildren();
    if (it.kind === 'variation') {
      const v = variantOf(it.variantId);
      const img = moEl('img', 'mo-bd-img', { alt: '' });
      el.append(img, caption(v ? v.name : 'A removed variation', v ? stageText(v.recipe) : ''));
      if (v) void paintVariation(v, img);
    } else if (it.kind === 'photo') {
      const img = moEl('img', 'mo-bd-img', { alt: '' });
      img.addEventListener('load', () => { const c = byId(it.id); if (c && !c.aspect && img.naturalWidth) { c.aspect = img.naturalWidth / img.naturalHeight; keepAspect(c, 'w'); place(c); scheduleSave(); } });
      ctx.thumb(img, it.photoId);
      el.append(img, caption(it.title || 'Photo', 'From the library'));
    } else if (it.kind === 'palette') {
      const v = variantOf(it.variantId);
      const list = v ? colourList(v.recipe) : [];
      const row = moEl('div', 'mo-bd-swatches', { role: 'group', 'aria-label': 'Swatches' });
      let far = 0;
      list.forEach((rgb, i) => {
        const mix = paints ? mixOf(rgb) : null;
        const isFar = !!(mix && mix.best && mix.best.closeness === 'Far');
        if (isFar) far++;
        const name = moColourName(rgb).name;
        const b = ui.createButton(row, { id: `media-organizer.board.swatch.${it.id}.${i}`, label: `${name}, ${hexOf(rgb)}${isFar ? ', far from your paints' : ''}`, kind: 'ghost', title: `${name} · ${hexOf(rgb)}`, command: 'media-organizer.board.openSwatch', args: [it.id, i] });
        b.classList.add('mo-bd-swatch');
        b.setAttribute('aria-label', `${name}, ${hexOf(rgb)}${isFar ? ', far from your paints' : ''}`);
        b.replaceChildren();
        if (isFar) b.appendChild(moEl('span', 'mo-bd-far', { textContent: '!', 'aria-hidden': 'true' }));
        b.style.background = hexOf(rgb);
      });
      if (!list.length) row.appendChild(moEl('div', 'mo-practice-dim mo-bd-pad', { textContent: 'No colours yet: pull them from the picture in the plan.' }));
      const values = !!(v && v.recipe && v.recipe.show === 'values'); // a values palette is greys or one paint: no mixing to report
      el.append(row, caption(`Palette · ${v ? v.name : 'a removed variation'}`, values ? `${list.length} values` : `${list.length} colour${list.length === 1 ? '' : 's'}${paints ? (far ? ` · ${far} far from your paints` : ' · all from your paints') : ''}`));
    } else if (it.kind === 'mix') {
      const n = moColourName(it.rgb), m = paints ? mixOf(it.rgb) : null;
      const head = moEl('div', 'mo-bd-mixhead');
      const sw = moEl('span', 'mo-bd-mixsw', { 'aria-hidden': 'true' }); sw.style.background = hexOf(it.rgb);
      const t = moEl('span', 'mo-pc-text'); t.append(moEl('span', 'mo-pc-name', { textContent: n.name }), moEl('span', 'mo-practice-dim mo-pc-sub', { textContent: `${cap(n.valueWord)} · value ${n.value}` }));
      head.append(sw, t);
      if (m && m.best) head.appendChild(moEl('span', `mo-pc-close mo-pc-close--${m.best.closeness.toLowerCase().replace(/\s+/g, '-')}`, { textContent: m.best.closeness }));
      el.appendChild(head);
      if (m && m.best) { el.append(mixBar(m.best), moEl('div', 'mo-bd-recipe', { textContent: recipeText(m.best) })); }
      else el.appendChild(moEl('div', 'mo-practice-dim mo-bd-pad', { textContent: paints ? 'Add your paints in the plan’s My Paints.' : 'Working out the mix…' }));
    } else if (it.kind === 'note') {
      const ta = moEl('textarea', 'mo-bd-note', { 'aria-label': 'Note', placeholder: 'Write a note' });
      ta.value = it.text || '';
      ta.addEventListener('change', () => { const c = byId(it.id); if (c) { c.text = ta.value; commit(); } });
      el.append(moEl('div', 'mo-bd-grip', { textContent: 'Note', 'aria-hidden': 'true' }), ta);
    } else if (it.kind === 'frame') {
      const inp = moEl('input', 'mo-bd-frame-title', { type: 'text', 'aria-label': 'Frame title' });
      inp.value = it.title || 'Frame';
      inp.addEventListener('change', () => { const c = byId(it.id); if (c) { c.title = inp.value.trim() || 'Frame'; commit(); } });
      el.appendChild(inp);
    }
    if (it.locked) el.appendChild(moEl('span', 'mo-bd-lock', { textContent: 'Locked', 'aria-hidden': 'true' }));
  }
  function caption(name, sub) {
    const c = moEl('div', 'mo-bd-cap');
    c.append(moEl('span', 'mo-pc-name', { textContent: name }), moEl('span', 'mo-practice-dim mo-pc-sub', { textContent: sub }));
    return c;
  }
  const recipeText = (rec) => (rec.paints.length === 1 ? `${rec.paints[0].name} on its own` : rec.paints.map((p) => (p.touch ? `a touch of ${p.name}` : `${p.parts} ${p.name}`)).join(' · '));
  function mixBar(rec) {
    const bar = moEl('div', 'mo-pc-bar', { role: 'img', 'aria-label': recipeText(rec) });
    const top = Math.max(...rec.paints.map((p) => p.parts));
    for (const p of rec.paints) { const s = moEl('span'); s.style.background = p.hex; s.style.flex = String(p.touch ? top * 0.06 : p.parts); bar.appendChild(s); }
    return bar;
  }
  const mixCache = new Map();
  function mixOf(rgb) {
    const key = hexOf(rgb);
    if (!mixCache.has(key)) mixCache.set(key, moMixRecipes(rgb, paints.paints, paints.rules));
    return mixCache.get(key);
  }
  async function paintVariation(v, img) {
    const key = JSON.stringify(v.recipe);
    const have = renders.get(v.id);
    if (have && have.key === key) { img.src = have.url; return; }
    try { const url = await ctx.renderVariant(v.recipe, 720); renders.set(v.id, { key, url }); if (!disposed) img.src = url; } catch { /* left blank */ }
  }
  function place(it) {
    const el = els.get(it.id);
    if (!el) return;
    el.style.left = `${it.x}px`; el.style.top = `${it.y}px`; el.style.width = `${it.w}px`; el.style.height = `${it.h}px`;
    el.style.zIndex = String(it.kind === 'frame' ? 0 : 10 + (it.z || 0));
  }
  function renderAll() {
    const keep = new Set(board.items.map((i) => i.id));
    for (const [id, el] of els) if (!keep.has(id)) { for (const d of disposersOf(el)) d(); el.remove(); els.delete(id); }
    for (const it of board.items) {
      if (it.kind === 'arrow') continue;
      let el = els.get(it.id);
      if (!el) { el = buildCard(it); els.set(it.id, el); world.appendChild(el); } else { fillCard(el, it); el.setAttribute('aria-label', labelOf(it)); }
      place(it);
    }
    // Reading order follows the board: top to bottom, then left to right.
    const order = board.items.filter((i) => i.kind !== 'arrow').sort((a, b) => (a.kind === 'frame') - (b.kind === 'frame') || Math.round(a.y / 80) - Math.round(b.y / 80) || a.x - b.x);
    for (const it of order) { const el = els.get(it.id); if (el) world.appendChild(el); }
    empty.classList.toggle('mo-hidden', board.items.length > 0);
    count.textContent = `Board · ${board.items.length} item${board.items.length === 1 ? '' : 's'}`;
    drawLinks(); drawOverlay(); drawMini();
  }
  function drawLinks() {
    links.replaceChildren();
    const edge = (a, b) => {
      const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const from = { x: ac.x, y: bc.y > a.y + a.h ? a.y + a.h : ac.y }, to = { x: bc.x < ac.x ? b.x + b.w : b.x, y: bc.y };
      const d = `M${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('class', 'mo-bd-link');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(to.x)); dot.setAttribute('cy', String(to.y)); dot.setAttribute('r', '3.5'); dot.setAttribute('class', 'mo-bd-link-dot');
      links.append(p, dot);
    };
    for (const it of board.items) {
      if (it.kind === 'arrow') { const a = byId(it.from), b = byId(it.to); if (a && b) edge(a, b); }
      else if (it.kind === 'mix' && it.fromId) { const a = byId(it.fromId); if (a) edge(a, it); }
    }
  }

  // ── selection overlay: handles, guides, the selected card's actions ──
  const ctxBar = moEl('div', 'mo-bd-ctxbar mo-hidden', { role: 'toolbar', 'aria-label': 'Selected card' });
  const handles = moEl('div', 'mo-bd-handles mo-hidden', { 'aria-hidden': 'true' });
  for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) handles.appendChild(moEl('span', `mo-bd-handle mo-bd-handle--${d}`, { 'data-dir': d }));
  const guides = moEl('div', 'mo-bd-guides', { 'aria-hidden': 'true' });
  const sizeTag = moEl('span', 'mo-bd-sizetag mo-hidden', { 'aria-hidden': 'true' });
  overlay.append(guides, handles, sizeTag, ctxBar);
  let ctxFor = '';
  function drawOverlay() {
    for (const [id, el] of els) el.classList.toggle('is-selected', sel.has(id));
    const one = sel.size === 1 ? byId([...sel][0]) : null;
    handles.classList.toggle('mo-hidden', !one || !!one.locked || one.kind === 'arrow');
    ctxBar.classList.toggle('mo-hidden', !one);
    if (!one) { ctxFor = ''; return; }
    const p = toScreen(one.x, one.y), w = one.w * board.view.z, h = one.h * board.view.z;
    Object.assign(handles.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${w}px`, height: `${h}px` });
    const key = `${one.id}:${one.kind}:${!!one.locked}`;
    if (key !== ctxFor) {
      ctxFor = key;
      ctxBar.replaceChildren();
      const b = (id, label, icon) => ui.createButton(ctxBar, { id: `media-organizer.board.ctx.${id}`, label, icon, size: 'sm', kind: 'ghost', command: `media-organizer.board.${id}` });
      if (one.kind === 'variation') { b('openPlan', 'Open In Plan'); b('paletteFromThis', 'Palette From This'); }
      b('bringToFront', 'Bring To Front', 'bring-to-front');
      b('lock', one.locked ? 'Unlock' : 'Lock', 'lock');
      b('removeSelected', 'Remove From Board', 'trash-2');
    }
    const bw = ctxBar.offsetWidth || 0, bh = ctxBar.offsetHeight || 36;
    ctxBar.style.left = `${Math.max(8, Math.min(p.x, view.clientWidth - bw - 8))}px`;
    ctxBar.style.top = `${p.y - bh - 10 >= 52 ? p.y - bh - 10 : Math.min(p.y + h + 10, view.clientHeight - bh - 8)}px`;
  }
  function showGuides(lines) {
    guides.replaceChildren();
    for (const l of lines) {
      const g = moEl('span', 'mo-bd-guide');
      if (l.x != null) { const s = toScreen(l.x, 0); Object.assign(g.style, { left: `${s.x}px`, top: '0', width: '1px', height: '100%' }); }
      else { const s = toScreen(0, l.y); Object.assign(g.style, { top: `${s.y}px`, left: '0', height: '1px', width: '100%' }); }
      guides.appendChild(g);
    }
  }
  // Snap a moving box to the edges and centres of the cards beside it.
  function snapBox(box, ignore) {
    const t = 6 / board.view.z;
    const others = board.items.filter((i) => !ignore.has(i.id) && i.kind !== 'arrow');
    let dx = 0, dy = 0; const lines = [];
    const xs = [box.x, box.x + box.w / 2, box.x + box.w], ys = [box.y, box.y + box.h / 2, box.y + box.h];
    let bestX = t + 1, bestY = t + 1;
    for (const o of others) {
      for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const x of xs) if (Math.abs(ox - x) < Math.abs(bestX)) { bestX = ox - x; dx = bestX; lines[0] = { x: ox }; }
      for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const y of ys) if (Math.abs(oy - y) < Math.abs(bestY)) { bestY = oy - y; dy = bestY; lines[1] = { y: oy }; }
    }
    if (Math.abs(bestX) > t) { dx = 0; lines[0] = null; }
    if (Math.abs(bestY) > t) { dy = 0; lines[1] = null; }
    return { dx, dy, lines: lines.filter(Boolean) };
  }

  // ── pointer: move, resize, pan, pinch ──
  const pointers = new Map();
  let gesture = null;
  function onDown(e) {
    if (e.target.closest('.mo-bd-toolbar, .mo-bd-zoom, .mo-bd-ctxbar, .mo-bd-pop')) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const card0 = e.target.closest('.mo-bd-item');
    // A press on a control inside a card (a swatch, the note, a frame's title) selects the card and leaves the press to the control.
    if (card0 && tool !== 'arrowTool' && e.target.closest('textarea, input, .mo-bd-swatch') && pointers.size === 0) {
      const id = Number(card0.dataset.id);
      if (!sel.has(id)) { sel.clear(); sel.add(id); drawOverlay(); }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { view.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; return; }
    const handle = e.target.closest('.mo-bd-handle');
    const card = e.target.closest('.mo-bd-item');
    const interactive = e.target.closest('textarea, input, .mo-bd-swatch');
    if (handle) {
      const it = byId([...sel][0]);
      if (it) { e.preventDefault(); gesture = { kind: 'resize', dir: handle.dataset.dir, it, start: { ...it }, x: e.clientX, y: e.clientY }; }
      return;
    }
    if (card && tool === 'arrowTool') { e.preventDefault(); pickArrow(Number(card.dataset.id)); return; }
    if (card && tool !== 'pan' && e.button === 0) {
      const id = Number(card.dataset.id);
      if (e.shiftKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); } else if (!sel.has(id)) { sel.clear(); sel.add(id); }
      drawOverlay();
      if (interactive) return;
      e.preventDefault();
      card.focus({ preventScroll: true });
      const moving = board.items.filter((i) => sel.has(i.id) && !i.locked);
      // A frame carries the cards inside it.
      for (const f of moving.filter((i) => i.kind === 'frame')) for (const i of board.items) if (!sel.has(i.id) && !i.locked && i.kind !== 'frame' && i.x >= f.x && i.y >= f.y && i.x + i.w <= f.x + f.w && i.y + i.h <= f.y + f.h) moving.push(i);
      gesture = { kind: 'move', items: moving.map((i) => ({ it: i, x: i.x, y: i.y })), x: e.clientX, y: e.clientY, moved: false };
      const top = Math.max(0, ...board.items.map((i) => i.z || 0));
      for (const g of gesture.items) if (g.it.kind !== 'frame' && (g.it.z || 0) < top) { g.it.z = top + 1; place(g.it); }
      return;
    }
    if (!e.shiftKey && !card) { sel.clear(); drawOverlay(); closePop(); }
    gesture = { kind: 'pan', x: e.clientX, y: e.clientY, vx: board.view.x, vy: board.view.y };
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    const z = board.view.z;
    if (gesture.kind === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const r = view.getBoundingClientRect();
      board.view.x += cx - gesture.cx; board.view.y += cy - gesture.cy;
      zoomAt(d / gesture.d, cx - r.left, cy - r.top);
      gesture.d = d; gesture.cx = cx; gesture.cy = cy;
    } else if (gesture.kind === 'pan') {
      board.view.x = gesture.vx + e.clientX - gesture.x; board.view.y = gesture.vy + e.clientY - gesture.y; board.view.set = true; applyView();
    } else if (gesture.kind === 'move') {
      let dx = (e.clientX - gesture.x) / z, dy = (e.clientY - gesture.y) / z;
      if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
      const lead = gesture.items[0];
      if (lead) {
        const ids = new Set(gesture.items.map((g) => g.it.id));
        const s = snapBox({ x: lead.x + dx, y: lead.y + dy, w: lead.it.w, h: lead.it.h }, ids);
        dx += s.dx; dy += s.dy; showGuides(s.lines);
      }
      for (const g of gesture.items) { g.it.x = Math.round(g.x + dx); g.it.y = Math.round(g.y + dy); place(g.it); }
      drawLinks(); drawOverlay();
    } else if (gesture.kind === 'resize') {
      const { it, start, dir } = gesture;
      const dx = (e.clientX - gesture.x) / z, dy = (e.clientY - gesture.y) / z;
      let { x, y, w, h } = start;
      if (dir.includes('e')) w = start.w + dx;
      if (dir.includes('s')) h = start.h + dy;
      if (dir.includes('w')) { w = start.w - dx; x = start.x + dx; }
      if (dir.includes('n')) { h = start.h - dy; y = start.y + dy; }
      it.w = Math.max(60, Math.round(w)); it.h = Math.max(40, Math.round(h));
      if (dir.includes('w')) it.x = Math.round(start.x + start.w - it.w); else it.x = Math.round(x);
      if (it.kind === 'variation' || it.kind === 'photo') keepAspect(it, dir === 'n' || dir === 's' ? 'h' : 'w');
      it.y = dir.includes('n') ? Math.round(start.y + start.h - it.h) : Math.round(y);
      place(it); drawLinks(); drawOverlay();
      sizeTag.classList.remove('mo-hidden'); sizeTag.textContent = `${it.w} × ${it.h}`;
      const p = toScreen(it.x + it.w, it.y + it.h); sizeTag.style.left = `${p.x - 70}px`; sizeTag.style.top = `${p.y + 8}px`;
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (gesture && (gesture.kind === 'move' || gesture.kind === 'resize')) { showGuides([]); sizeTag.classList.add('mo-hidden'); if (gesture.kind === 'resize' || gesture.moved) commit(); }
    if (gesture && gesture.kind === 'pan') scheduleSave();
    if (pointers.size < 2) gesture = pointers.size ? null : null;
    drawMini();
  }
  function onWheel(e) {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    else { board.view.x -= e.deltaX; board.view.y -= e.deltaY; applyView(); scheduleSave(); }
  }
  view.style.touchAction = 'none';
  view.addEventListener('pointerdown', onDown); view.addEventListener('pointermove', onMove);
  view.addEventListener('pointerup', onUp); view.addEventListener('pointercancel', onUp);
  view.addEventListener('wheel', onWheel, { passive: false });
  mini.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const b = bounds(board.items.filter((i) => i.kind !== 'arrow')); if (!b) return;
    const r = mini.getBoundingClientRect(), k = Math.min((r.width - 16) / b.w, (r.height - 16) / b.h);
    const wx = b.x + (e.clientX - r.left - 8) / k, wy = b.y + (e.clientY - r.top - 8) / k;
    board.view.x = view.clientWidth / 2 - wx * board.view.z; board.view.y = view.clientHeight / 2 - wy * board.view.z; applyView(); scheduleSave();
  });
  function drawMini() {
    const g = mini.getContext('2d'); if (!g) return;
    const css = getComputedStyle(root);
    g.clearRect(0, 0, mini.width, mini.height);
    const b = bounds(board.items.filter((i) => i.kind !== 'arrow'));
    mini.classList.toggle('mo-hidden', !b);
    if (!b) return;
    const k = Math.min((mini.width - 16) / b.w, (mini.height - 16) / b.h);
    for (const i of board.items) {
      if (i.kind === 'arrow') continue;
      g.fillStyle = css.getPropertyValue(i.kind === 'frame' ? '--px-bg-inset' : '--px-border-strong').trim() || 'gray';
      g.fillRect(8 + (i.x - b.x) * k, 8 + (i.y - b.y) * k, Math.max(2, i.w * k), Math.max(2, i.h * k));
    }
    g.strokeStyle = css.getPropertyValue('--px-accent').trim() || 'blue'; g.lineWidth = 1.5;
    const v = board.view;
    g.strokeRect(8 + (-v.x / v.z - b.x) * k, 8 + (-v.y / v.z - b.y) * k, (view.clientWidth / v.z) * k, (view.clientHeight / v.z) * k);
  }

  // ── keys on the board ──
  root.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !typing) { e.preventDefault(); if (e.shiftKey) { if (hIdx < history.length - 1) restore(hIdx + 1); } else if (hIdx > 0) restore(hIdx - 1); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y') && !typing) { e.preventDefault(); if (hIdx < history.length - 1) restore(hIdx + 1); return; }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    const onCard = e.target.closest && e.target.closest('.mo-bd-item');
    if (e.key === 'Escape') { if (pop) closePop(); else if (tool !== 'select') setTool('select'); else { sel.clear(); drawOverlay(); } return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); acts.removeSelected(); return; }
    if (e.key === 'Enter' && onCard && e.target === onCard) {
      e.preventDefault();
      const it = byId(Number(onCard.dataset.id));
      if (tool === 'arrowTool') { pickArrow(it.id); return; }
      if (it.kind === 'variation') acts.openPlan();
      else { const inner = onCard.querySelector('textarea, input, .mo-bd-swatch'); if (inner) inner.focus(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.25, view.clientWidth / 2, view.clientHeight / 2); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(0.8, view.clientWidth / 2, view.clientHeight / 2); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
  });

  // ── tools ──
  function setTool(t) {
    tool = t; arrowFrom = null;
    view.dataset.tool = t;
    for (const [b, on] of [[tSelect, t === 'select'], [tPan, t === 'pan'], [tArrow, t === 'arrowTool']]) { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    live.textContent = t === 'arrowTool' ? 'Arrow: choose the card it starts from, then the card it points to.' : '';
  }
  function pickArrow(id) {
    if (!arrowFrom) { arrowFrom = id; live.textContent = 'Now choose the card the arrow points to.'; return; }
    if (arrowFrom !== id) { board.items.push({ id: board.next++, kind: 'arrow', from: arrowFrom, to: id, x: 0, y: 0, w: 0, h: 0 }); commit(); drawLinks(); live.textContent = 'Arrow added.'; }
    setTool('select');
  }
  function add(it, at) {
    const spot = at || centreSpot(it.w, it.h);
    const n = Object.assign({ id: board.next++ }, it, { x: spot.x, y: spot.y });
    board.items.push(n);
    sel.clear(); sel.add(n.id);
    renderAll(); commit(); reveal(n);
    const el = els.get(n.id); if (el) el.focus({ preventScroll: true });
    return n;
  }
  const variationSize = (v) => { const w = 290, c = v && v.recipe && v.recipe.canvas; return { w, h: Math.round(w / (c ? c.w / c.h : aspect()) + 44) }; };
  function menuAt(anchor, label, items) { ui.createMenu(anchor, { id: `media-organizer.board.menu.${label.toLowerCase().replace(/\s+/g, '-')}`, label, items }); }

  // ── popovers: a swatch's mix, the photo picker ──
  let pop = null, popOpener = null;
  function closePop() { if (!pop) return; pop.remove(); pop = null; if (popOpener && popOpener.isConnected) popOpener.focus(); popOpener = null; }
  function openPop(node, anchor, label) {
    closePop();
    popOpener = document.activeElement;
    pop = moEl('div', 'mo-bd-pop', { role: 'dialog', 'aria-label': label });
    pop.appendChild(node);
    overlay.appendChild(pop);
    const r = anchor.getBoundingClientRect(), vr = view.getBoundingClientRect();
    pop.style.left = `${clamp(r.left - vr.left, 8, vr.width - 340)}px`;
    pop.style.top = `${clamp(r.bottom - vr.top + 8, 8, vr.height - 420)}px`;
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); } });
    const first = pop.querySelector('input, button'); if (first) first.focus();
  }

  const acts = {
    select() { setTool('select'); },
    pan() { setTool(tool === 'pan' ? 'select' : 'pan'); },
    arrowTool() { setTool(tool === 'arrowTool' ? 'select' : 'arrowTool'); },
    addNote() { add({ kind: 'note', text: '', w: 250, h: 160 }); },
    addFrame() { add({ kind: 'frame', title: 'Frame', w: 640, h: 420, z: -1 }); },
    addVariation(variantId) {
      if (variantId != null) { const v = variantOf(variantId); if (v) add(Object.assign({ kind: 'variation', variantId: v.id }, variationSize(v))); return; }
      menuAt(tVariation, 'Add A Variation', variants.map((v) => ({ label: v.name, onSelect: () => acts.addVariation(v.id) })));
    },
    addPalette(variantId) {
      if (variantId != null) { const v = variantOf(variantId); if (v) add({ kind: 'palette', variantId: v.id, w: 290, h: 110 }); return; }
      menuAt(tPalette, 'Add A Palette', variants.map((v) => ({ label: `${v.name} (${colourList(v.recipe).length} colours)`, onSelect: () => acts.addPalette(v.id) })));
    },
    addPhoto() {
      const box = moEl('div', 'mo-bd-picker');
      box.appendChild(moEl('div', 'mo-pc-name', { textContent: 'Add a photo' }));
      const input = moEl('input', 'mo-clip-input', { type: 'search', 'aria-label': 'Search photos', placeholder: 'Search the library' });
      const grid = moEl('div', 'mo-bd-picker-grid', { role: 'group', 'aria-label': 'Photos' });
      const hint = moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'Choose a photo to add it.' });
      box.append(input, grid, hint);
      let seq = 0;
      const search = async () => {
        const mine = ++seq;
        const found = await ctx.searchPhotos(input.value.trim()).catch(() => []);
        if (mine !== seq || !pop) return;
        grid.replaceChildren();
        for (const p of found.slice(0, 24)) {
          const b = ui.createButton(grid, { id: `media-organizer.board.pick.${p.id}`, label: p.title || 'Photo', kind: 'ghost', title: p.title || '', command: 'media-organizer.board.pickPhoto', args: [p.id, p.title || ''] });
          b.classList.add('mo-bd-pick');
          b.setAttribute('aria-label', p.title || `Photo ${p.id}`);
          const img = moEl('img', null, { alt: '' });
          b.replaceChildren(img);
          ctx.thumb(img, p.id);
        }
        if (!found.length) grid.appendChild(moEl('div', 'mo-practice-dim', { textContent: 'No photos match.' }));
      };
      let t = 0;
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 220); });
      openPop(box, tPhoto, 'Add a photo');
      void search();
    },
    pickPhoto(photoId, name) { closePop(); add({ kind: 'photo', photoId, title: name || '', w: 260, h: 300 }); },
    zoomIn() { zoomAt(1.25, view.clientWidth / 2, view.clientHeight / 2); },
    zoomOut() { zoomAt(0.8, view.clientWidth / 2, view.clientHeight / 2); },
    fit() { fit(); },
    openPlan() { ctx.openPlan(); },
    paletteFromThis() {
      const it = byId([...sel][0]); if (!it || it.kind !== 'variation') return;
      add({ kind: 'palette', variantId: it.variantId, w: it.w, h: 110 }, { x: it.x, y: it.y + it.h + 24 });
    },
    bringToFront() { const top = Math.max(0, ...board.items.map((i) => i.z || 0)); for (const id of sel) { const it = byId(id); if (it && it.kind !== 'frame') it.z = top + 1; } renderAll(); commit(); },
    lock() { const it = byId([...sel][0]); if (!it) return; it.locked = !it.locked; renderAll(); commit(); live.textContent = it.locked ? 'Locked' : 'Unlocked'; },
    removeSelected() {
      if (!sel.size) return;
      const gone = new Set(sel);
      board.items = board.items.filter((i) => !gone.has(i.id) && !(i.kind === 'arrow' && (gone.has(i.from) || gone.has(i.to))));
      for (const i of board.items) if (i.kind === 'mix' && gone.has(i.fromId)) delete i.fromId;
      sel.clear(); renderAll(); commit();
      live.textContent = `Removed ${gone.size} item${gone.size === 1 ? '' : 's'}. Ctrl+Z brings ${gone.size === 1 ? 'it' : 'them'} back.`;
      view.focus();
    },
    openSwatch(itemId, index) {
      const it = byId(itemId), v = it && variantOf(it.variantId), rgb = v && colourList(v.recipe)[index];
      if (!rgb) return;
      const anchor = els.get(itemId)?.querySelectorAll('.mo-bd-swatch')[index] || els.get(itemId);
      const n = moColourName(rgb), m = paints ? mixOf(rgb) : null;
      const box = moEl('div', 'mo-bd-swatchpop');
      const head = moEl('div', 'mo-pc-colour');
      const chip = moEl('div', 'mo-pc-chip-lg'); chip.style.background = hexOf(rgb);
      const t = moEl('div', 'mo-pc-text'); t.append(moEl('span', 'mo-pc-name', { textContent: n.name }), moEl('span', 'mo-practice-dim mo-pc-sub', { textContent: `${cap(n.valueWord)} · value ${n.value} of 10` }), moEl('span', 'mo-practice-dim mo-pc-hex', { textContent: hexOf(rgb) }));
      head.append(chip, t); box.appendChild(head);
      if (m && m.best) {
        const h2 = moEl('div', 'mo-pc-head');
        h2.append(moEl('div', 'mo-practice-section-title', { textContent: 'Best mix with your paints' }), moEl('span', `mo-pc-close mo-pc-close--${m.best.closeness.toLowerCase().replace(/\s+/g, '-')}`, { textContent: m.best.closeness }));
        box.append(h2, mixBar(m.best));
        for (const p of m.best.paints) { const r = moEl('div', 'mo-pc-paint'); const d = moEl('span', 'mo-pc-dot', { 'aria-hidden': 'true' }); d.style.background = p.hex; r.append(d, moEl('span', null, { textContent: p.name }), moEl('span', 'mo-practice-dim', { textContent: m.best.paints.length === 1 ? 'on its own' : p.touch ? 'a touch' : `${p.parts} part${p.parts === 1 ? '' : 's'}` })); box.appendChild(r); }
      } else box.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'Add your paints in the plan’s My Paints to see how to mix it.' }));
      const row = moEl('div', 'mo-plan-row');
      ui.createButton(row, { id: 'media-organizer.board.pinMix', label: 'Pin Mix To Board', size: 'sm', kind: 'primary', command: 'media-organizer.board.pinMix', args: [itemId, index] });
      ui.createButton(row, { id: 'media-organizer.board.copyRecipe', label: 'Copy Recipe', size: 'sm', command: 'media-organizer.board.copyRecipe', args: [itemId, index] });
      ui.createButton(row, { id: 'media-organizer.board.closePopover', label: 'Close', size: 'sm', kind: 'ghost', command: 'media-organizer.board.closePopover' });
      box.appendChild(row);
      openPop(box, anchor, `${n.name}: how to mix it`);
    },
    pinMix(itemId, index) {
      const it = byId(itemId), v = it && variantOf(it.variantId), rgb = v && colourList(v.recipe)[index];
      if (!rgb) return;
      closePop();
      const already = board.items.filter((i) => i.kind === 'mix' && i.fromId === itemId).length;
      add({ kind: 'mix', rgb: rgb.slice(0, 3), fromId: itemId, w: 260, h: 132 }, { x: it.x + it.w + 60, y: it.y + already * 150 });
    },
    async copyRecipe(itemId, index) {
      const it = byId(itemId), v = it && variantOf(it.variantId), rgb = v && colourList(v.recipe)[index];
      if (!rgb || !paints) return;
      const m = mixOf(rgb);
      try { await navigator.clipboard.writeText(`${moColourName(rgb).name} (${hexOf(rgb)}): ${m.best ? recipeText(m.best) : 'no mix'}`); live.textContent = 'Recipe copied'; } catch { /* no clipboard */ }
    },
    closePopover() { closePop(); },
    exportMenu() {
      ui.createMenu(exportBtn, { id: 'media-organizer.board.exportChoices', label: 'Export', items: [
        { label: 'Save To Library', icon: 'library', tooltip: 'Beside the original photo, in the library', onSelect: () => void acts.exportImage(false) },
        { label: 'Export As File…', icon: 'image-up', tooltip: 'Anywhere, as PNG', onSelect: () => void acts.exportImage(true) },
      ] });
    },
    async exportImage(toFile) {
      try {
        const path = await exportBoard(!!toFile);
        if (path) api.window.showInformationMessage(`${toFile ? 'Exported' : 'Saved to the library:'} ${path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)}`);
      } catch (err) { api.window.showErrorMessage('The board could not be exported: ' + (err && err.message)); }
    },
  };

  // ── export: the board as one picture beside the original photo ──
  async function exportBoard(toFile) {
    const items = board.items.filter((i) => i.kind !== 'arrow');
    const b = bounds(items); if (!b) return null;
    const pad = 40, k = Math.min(2, 8000 / Math.max(b.w + pad * 2, b.h + pad * 2));
    const cv = moEl('canvas', null, { width: String(Math.round((b.w + pad * 2) * k)), height: String(Math.round((b.h + pad * 2) * k)) });
    const g = cv.getContext('2d');
    const css = getComputedStyle(root), tok = (n, f) => css.getPropertyValue(n).trim() || f;
    g.scale(k, k); g.translate(pad - b.x, pad - b.y);
    g.fillStyle = tok('--px-bg', 'black'); g.fillRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    const text = (s, x, y, size, color, weight) => { g.fillStyle = color; g.font = `${weight || 400} ${size}px ${tok('--px-font-ui', 'sans-serif')}`; g.fillText(s, x, y); };
    for (const it of [...items].sort((a, c) => (a.kind === 'frame' ? -1 : 0) - (c.kind === 'frame' ? -1 : 0) || (a.z || 0) - (c.z || 0))) {
      const el = els.get(it.id);
      if (it.kind === 'frame') { g.setLineDash([6, 4]); g.strokeStyle = tok('--px-border-strong', 'gray'); g.strokeRect(it.x, it.y, it.w, it.h); g.setLineDash([]); text(it.title || 'Frame', it.x + 12, it.y - 8, 13, tok('--px-text-secondary', 'gray'), 600); continue; }
      g.fillStyle = tok('--px-bg-elevated', 'black'); g.fillRect(it.x, it.y, it.w, it.h);
      const img = el && el.querySelector('img');
      if (img && img.complete && img.naturalWidth) { const ih = it.h - 44; g.drawImage(img, it.x, it.y, it.w, Math.max(1, ih)); }
      if (it.kind === 'palette') { const sws = el ? [...el.querySelectorAll('.mo-bd-swatch')] : []; sws.forEach((s, i) => { g.fillStyle = s.style.background; g.fillRect(it.x + (i * it.w) / sws.length, it.y, it.w / sws.length + 0.5, 56); }); }
      if (it.kind === 'mix') { g.fillStyle = hexOf(it.rgb); g.fillRect(it.x + 12, it.y + 12, 36, 36); }
      const cap = el && el.querySelector('.mo-bd-cap .mo-pc-name');
      const lines = it.kind === 'note' ? String(it.text || '').split('\n') : it.kind === 'mix' ? [moColourName(it.rgb).name, (el && el.querySelector('.mo-bd-recipe') || {}).textContent || ''] : [cap ? cap.textContent : ''];
      lines.forEach((l, i) => text(l.slice(0, 60), it.x + (it.kind === 'mix' ? 58 : 12), (it.kind === 'note' || it.kind === 'mix' ? it.y + 28 : it.y + it.h - 18) + i * 18, 13, tok('--px-text', 'white'), i ? 400 : 600));
    }
    g.strokeStyle = tok('--px-accent', 'blue'); g.lineWidth = 1.5;
    for (const p of links.querySelectorAll('path')) g.stroke(new Path2D(p.getAttribute('d')));
    const src = await ctx.sourcePath();
    if (!src) throw new Error('The plan’s photo is not on disk right now.');
    const sep = src.includes('\\') ? '\\' : '/', dir = src.slice(0, src.lastIndexOf(sep)), base = src.slice(src.lastIndexOf(sep) + 1).replace(/\.[^.]+$/, '');
    if (toFile) {
      const chosen = await window.parallxElectron.dialog.saveFile({ title: 'Export Board', defaultPath: `${dir}${sep}${base}_board.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
      const path = typeof chosen === 'string' ? chosen : chosen && (chosen.filePath || chosen.path);
      if (!path) return null;
      const data = cv.toDataURL('image/png'), res = await window.parallxElectron.fs.writeFile(path, data.slice(data.indexOf(',') + 1), 'base64');
      if (res && res.error) throw new Error(res.error.message || String(res.error));
      return path;
    }
    let out = null;
    for (let n = 1; n < 100 && !out; n++) { const c = `${dir}${sep}${base}_board_${n}.png`; if (!(await window.parallxElectron.fs.exists(c))) out = c; }
    if (!out) throw new Error('No free file name beside the original.');
    const data = cv.toDataURL('image/png');
    const res = await window.parallxElectron.fs.writeFile(out, data.slice(data.indexOf(',') + 1), 'base64');
    if (res && res.error) throw new Error(res.error.message || String(res.error));
    await ctx.ingest(out);
    return out;
  }

  // ── life ──
  const handle = { root, planId: ctx.planId, act: (name, ...args) => acts[name] && acts[name](...args) };
  open.add(handle); lastUsed = handle;
  root.addEventListener('focusin', () => { lastUsed = handle; });
  async function load(keepView) {
    const data = await ctx.loadPlan();
    if (disposed || !data) return;
    plan = data.plan; variants = data.variants;
    title.textContent = plan.title || 'Painting';
    const fresh = await moBoardLoad(ctx.db, ctx.planId);
    if (keepView) fresh.view = board.view;
    board = fresh;
    if (!history.length) { history.push(snap()); hIdx = 0; }
    renderAll(); applyView();
    if (!keepView && board.items.length && !fresh.view.set) requestAnimationFrame(() => { if (!disposed) fit(); }); // a board never looked at opens fitted
  }
  void moPlanPaintSet(io).then((p) => { paints = p; mixCache.clear(); if (!disposed) renderAll(); });
  const onChanged = (e) => { if (e.detail && e.detail.planId === ctx.planId) void load(true); };
  const onPlans = () => { void ctx.loadPlan().then((d) => { if (!d || disposed) return; plan = d.plan; variants = d.variants; renders.clear(); renderAll(); }); };
  document.addEventListener('mo:board-changed', onChanged);
  document.addEventListener('mo:plans-changed', onPlans);
  const ro = new ResizeObserver(() => { drawOverlay(); drawMini(); });
  ro.observe(view);
  setTool('select');
  void load(false);
  return {
    dispose() {
      disposed = true;
      clearTimeout(saveTimer);
      void moBoardSave(ctx.db, ctx.planId, board).catch(() => {});
      open.delete(handle); if (lastUsed === handle) lastUsed = null;
      document.removeEventListener('mo:board-changed', onChanged);
      document.removeEventListener('mo:plans-changed', onPlans);
      ro.disconnect();
      for (const el of els.values()) for (const d of disposersOf(el)) d();
      for (const s of subs) { try { s.dispose(); } catch { /* gone */ } }
      container.replaceChildren();
    },
  };
}
