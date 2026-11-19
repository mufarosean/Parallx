// colour-study-home.js — Colour Study's commands and its home in Studio: every
// sheet as a card, and New Colour Study. A sheet's own actions are commands
// too (media-organizer.colour.*), run on the sheet in use: the one holding
// the focus, else the one used last.

import { moEl } from './dom.js';
import { moHex } from './paint-engine.js';
import { HOME, cleanState, defaultState, parse } from './colour-study-state.js';

let deps = null;
export const moColourDeps = () => deps;

// The open sheets, for the commands.
const open = new Set();
let lastUsed = null;
const sheetInUse = () => [...open].find((s) => s.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
/** A sheet says it is open: { root, act(name, ...args) }. Returns how to say it has closed. */
export function moColourSheetOpened(handle) {
  open.add(handle); lastUsed = handle;
  const used = () => { lastUsed = handle; };
  handle.root.addEventListener('focusin', used); handle.root.addEventListener('pointerdown', used, true);
  return () => { open.delete(handle); if (lastUsed === handle) lastUsed = null; handle.root.removeEventListener('focusin', used); handle.root.removeEventListener('pointerdown', used, true); };
}
/** Everything a sheet's controls run. */
export const MO_COLOUR_ACTIONS = ['morePhotos', 'role', 'myPaints', 'valueCheck', 'hatch', 'choosePlan', 'choosePicture', 'pickPhoto', 'mass', 'pick', 'cell', 'editMix', 'copyRecipe', 'studyThis', 'putOnPalette', 'twinsGrey', 'why', 'tubeOn',
  'resetMix', 'closeBench', 'less', 'more', 'swap', 'dropPaint', 'nudge', 'fix', 'closePaints', 'saveSet', 'deleteSet', 'starterPaints', 'paintColour', 'removePaint', 'customPaint'];

// ── commands and the home ───────────────────────────────────────────────────

/** d: { api, db, getSetting, setSetting, openHome(), openSheet(id, title), searchPhotos(text), thumb(img, photoId), photoPicture(photoId, max) -> data URL, plans() -> [{ id, title }], planSnapshot(planId, variantId?) -> { title, picture, colours: [rgb] } } */
export function moColourStudyActivate(api, d) {
  deps = d;
  const changed = () => document.dispatchEvent(new CustomEvent(HOME));
  async function newSheet(seed) {
    const n = await d.db.get('SELECT COUNT(*) AS n FROM mo_colour_sheets');
    const title = (seed && seed.title) || `Colour Study ${((n && n.n) || 0) + 1}`;
    const st = cleanState(seed && seed.state);
    const now = new Date().toISOString();
    await d.db.run('INSERT INTO mo_colour_sheets (title, state_json, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [title.slice(0, 80), JSON.stringify(st), (seed && seed.picture) || '', now, now]);
    const row = await d.db.get('SELECT id FROM mo_colour_sheets ORDER BY id DESC LIMIT 1');
    changed();
    if (row) d.openSheet(row.id, title);
    return row ? row.id : null;
  }
  const acts = {
    newSheet: () => newSheet(null),
    open: async (id) => { const r = await d.db.get('SELECT title FROM mo_colour_sheets WHERE id = ?', [id]); if (r) d.openSheet(id, r.title); },
    async rename(id, to) {
      const r = await d.db.get('SELECT title FROM mo_colour_sheets WHERE id = ?', [id]);
      const t = r && (to != null ? to : await api.window.showInputBox({ prompt: 'Name this colour study', value: r.title }));
      if (!t || !String(t).trim()) return;
      await d.db.run('UPDATE mo_colour_sheets SET title = ?, updated_at = ? WHERE id = ?', [String(t).trim().slice(0, 80), new Date().toISOString(), id]);
      changed();
    },
    async remove(id) {
      const r = await d.db.get('SELECT title FROM mo_colour_sheets WHERE id = ?', [id]);
      if (!r || !(await api.window.showConfirmModal({ message: `Delete the colour study "${r.title}"?`, detail: 'Its colours, mix and notes go with it. Your paints stay.', confirmLabel: 'Delete', danger: true }))) return;
      await d.db.run('DELETE FROM mo_colour_sheets WHERE id = ?', [id]);
      changed();
    },
    /** A sheet from a photo in the library (its right-click menu): the photo, its colours read from the original. */
    async fromPhoto(photoId) {
      const id = Number(photoId);
      const picture = id > 0 ? await d.photoPicture(id, 1600).catch(() => null) : null;
      if (!picture) { api.window.showWarningMessage('That photo is not on disk right now.'); return null; }
      const name = await d.photoTitle(id);
      const st = defaultState();
      Object.assign(st, { source: 'picture', pictureRef: { photo: id }, pictureFrom: name ? `From ${name}` : 'From the library' });
      return newSheet({ title: `${name || 'Photo'} Colours`, state: st, picture });
    },
    /** A sheet from a painting plan: its picture as it stands and its colours. */
    async fromPlan(planId, variantId) {
      const snap = await d.planSnapshot(planId, variantId);
      if (!snap) { api.window.showWarningMessage('That plan could not be read.'); return null; }
      const masses = (snap.colours || []).map(moHex).filter((h, i, a) => a.indexOf(h) === i).slice(0, 16);
      const st = defaultState();
      if (masses.length) { st.colours = masses.slice(0, 9); st.harmony = 'none'; }
      Object.assign(st, { masses, source: snap.picture ? 'picture' : 'wheel', pictureFrom: `From the plan ${snap.title}` });
      return newSheet({ title: `${snap.title} Colours`, state: st, picture: snap.picture || '' });
    },
  };
  return [
    api.commands.registerCommand('media-organizer.colourStudy', () => d.openHome()),
    api.commands.registerCommand('media-organizer.plan.openInColourStudy', (planId, variantId) => { const id = planId != null ? planId : d.planInUse && d.planInUse(); return id != null ? acts.fromPlan(id, variantId) : null; }),
    ...Object.entries(acts).map(([k, fn]) => api.commands.registerCommand(`media-organizer.colour.${k}`, fn)),
    ...MO_COLOUR_ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.colour.${a}`, (...args) => { const s = sheetInUse(); return s ? s.act(a, ...args) : undefined; })),
  ];
}

export function moRenderColourHome(container, api) {
  const ui = api.ui;
  const root = moEl('div', 'mo-practice-setup mo-plans mo-cs-home');
  container.appendChild(root);
  let disposed = false;
  const head = moEl('div', 'mo-plans-head');
  const words = moEl('div', 'mo-plans-words');
  words.append(moEl('div', 'mo-home-title', { textContent: 'Colour Study' }), moEl('div', 'mo-home-sub', { textContent: 'Learn to mix a colour from the paints you have: what goes in it and why, and what each tube does to it.' }));
  head.appendChild(words);
  ui.createButton(head, { id: 'media-organizer.colour.newSheet', label: 'New Colour Study', icon: 'plus', kind: 'primary', command: 'media-organizer.colour.newSheet' });
  root.appendChild(head);
  const grid = moEl('div', 'mo-plans-grid', { role: 'list', 'aria-label': 'Colour studies' });
  root.appendChild(grid);
  async function load() {
    const rows = await deps.db.all('SELECT id, title, state_json, picture, updated_at FROM mo_colour_sheets ORDER BY updated_at DESC').catch(() => []);
    if (disposed) return;
    const had = grid.contains(document.activeElement) && document.activeElement.getAttribute('data-px-id');
    grid.replaceChildren();
    if (!rows.length) { grid.appendChild(moEl('div', 'mo-practice-dim', { textContent: 'No colour studies yet. New Colour Study starts one from the painter’s wheel; a painting plan can open one from its picture.' })); return; }
    for (const r of rows) {
      const st = cleanState(parse(r.state_json, null));
      const card = moEl('article', 'mo-plans-card', { role: 'listitem', 'aria-label': r.title });
      const openBtn = ui.createButton(card, { id: `media-organizer.colour.open.${r.id}`, label: `Open ${r.title}`, icon: 'swatch-book', kind: 'ghost', command: 'media-organizer.colour.open', args: [r.id] });
      openBtn.classList.add('mo-plans-open');
      const strip = moEl('span', 'mo-cs-home-strip', { 'aria-hidden': 'true' });
      for (const c of st.colours) { const s = moEl('span'); s.style.background = c; strip.appendChild(s); }
      openBtn.replaceChildren(strip, moEl('span', 'mo-plans-card-title', { textContent: r.title }), moEl('span', 'mo-practice-dim', { textContent: `${st.colours.length} colour${st.colours.length === 1 ? '' : 's'}${r.picture ? ' · with a picture' : ''}` }), moEl('span', 'mo-practice-dim', { textContent: deps.date ? deps.date(r.updated_at) : '' }));
      const actions = moEl('div', 'mo-plans-actions');
      ui.createIconButton(actions, { id: `media-organizer.colour.rename.${r.id}`, icon: 'pencil', title: `Rename ${r.title}…`, size: 'sm', command: 'media-organizer.colour.rename', args: [r.id] });
      ui.createIconButton(actions, { id: `media-organizer.colour.remove.${r.id}`, icon: 'trash-2', title: `Delete ${r.title}…`, size: 'sm', command: 'media-organizer.colour.remove', args: [r.id] });
      card.appendChild(actions);
      grid.appendChild(card);
    }
    if (had) { const el = grid.querySelector(`[data-px-id="${CSS.escape(had)}"]`); if (el) el.focus(); }
  }
  document.addEventListener(HOME, load);
  void load();
  return { dispose() { disposed = true; document.removeEventListener(HOME, load); container.replaceChildren(); } };
}

