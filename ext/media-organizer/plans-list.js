// plans-list.js — the Painting Plans home: every plan as a card with its
// photo, its variations and colours, and the ways in (the plan, its board),
// plus New Plan From Photo…, which picks a photo from the library here.
// Every action is a command (media-organizer.plans.*).

import { moEl } from './dom.js';
import { moColourName } from './colour.js';

let deps = null;
const pages = new Set();
const hexOf = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** d: { api, db, thumb(img, photoId), openPlan(id), openBoard(id), createPlan(photoId), searchPhotos(text), date(iso) } */
export function moPlansListActivate(api, d) {
  deps = d;
  const changed = () => document.dispatchEvent(new CustomEvent('mo:plans-changed'));
  const acts = {
    open: (id) => d.openPlan(id),
    board: (id) => d.openBoard(id),
    async rename(id) {
      const p = await d.db.get('SELECT title FROM mo_plans WHERE id = ?', [id]);
      const t = p && await api.window.showInputBox({ prompt: 'Name this plan', value: p.title });
      if (!t || !String(t).trim()) return;
      await d.db.run('UPDATE mo_plans SET title = ?, updated_at = ? WHERE id = ?', [String(t).trim().slice(0, 80), new Date().toISOString(), id]);
      changed();
    },
    async remove(id) {
      const p = await d.db.get('SELECT title FROM mo_plans WHERE id = ?', [id]);
      if (!p || (await api.window.showWarningMessage(`Delete the plan "${p.title}"? Its variations, notes, saved colours and board go with it. The photo stays.`, { title: 'Delete' }, { title: 'Cancel' }))?.title !== 'Delete') return;
      await d.db.run('DELETE FROM mo_plan_boards WHERE plan_id = ?', [id]).catch(() => {});
      await d.db.run('DELETE FROM mo_plans WHERE id = ?', [id]);
      changed();
    },
    newPlan() { for (const pg of pages) pg.togglePicker(true); },
    closePicker() { for (const pg of pages) pg.togglePicker(false); },
    pick(photoId) { for (const pg of pages) pg.togglePicker(false); return d.createPlan(photoId); },
  };
  return Object.entries(acts).map(([k, fn]) => api.commands.registerCommand(`media-organizer.plans.${k}`, fn));
}

export function moRenderPlansList(container, api) {
  const ui = api.ui;
  const root = moEl('div', 'mo-practice-setup mo-plans');
  container.appendChild(root);
  let disposed = false;
  const head = moEl('div', 'mo-plans-head');
  const words = moEl('div', 'mo-plans-words');
  words.append(moEl('div', 'mo-home-title', { textContent: 'Painting Plans' }), moEl('div', 'mo-home-sub', { textContent: 'Work the design out on the photo before the canvas: crop, values, colours and a board to lay it all out.' }));
  head.appendChild(words);
  const newBtn = ui.createButton(head, { id: 'media-organizer.plans.newPlan', label: 'New Plan From Photo…', kind: 'primary', command: 'media-organizer.plans.newPlan' });
  newBtn.setAttribute('aria-expanded', 'false');
  root.appendChild(head);

  // The photo picker, opened by New Plan From Photo…
  const picker = moEl('section', 'mo-plans-picker mo-hidden', { 'aria-label': 'Choose a photo to plan' });
  const pickHead = moEl('div', 'mo-pc-head');
  pickHead.appendChild(moEl('div', 'mo-pc-name', { textContent: 'Choose a photo to plan' }));
  ui.createButton(pickHead, { id: 'media-organizer.plans.closePicker', label: 'Cancel', size: 'sm', kind: 'ghost', command: 'media-organizer.plans.closePicker' });
  const search = moEl('input', 'mo-clip-input', { type: 'search', 'aria-label': 'Search photos', placeholder: 'Search the library' });
  const results = moEl('div', 'mo-plans-picker-grid', { role: 'group', 'aria-label': 'Photos' });
  picker.append(pickHead, search, results);
  root.appendChild(picker);
  let seq = 0, t = 0;
  async function findPhotos() {
    const mine = ++seq;
    const found = await deps.searchPhotos(search.value.trim()).catch(() => []);
    if (mine !== seq || disposed) return;
    results.replaceChildren();
    for (const p of found.slice(0, 24)) {
      const b = ui.createButton(results, { id: `media-organizer.plans.pick.${p.id}`, label: p.title || `Photo ${p.id}`, kind: 'ghost', title: p.title || '', command: 'media-organizer.plans.pick', args: [p.id] });
      b.classList.add('mo-plans-pick');
      b.setAttribute('aria-label', `Plan ${p.title || `photo ${p.id}`}`);
      const img = moEl('img', null, { alt: '' });
      b.replaceChildren(img);
      deps.thumb(img, p.id);
    }
    if (!found.length) results.appendChild(moEl('div', 'mo-practice-dim', { textContent: 'No photos match.' }));
  }
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(findPhotos, 220); });
  const page = {
    togglePicker(on) {
      picker.classList.toggle('mo-hidden', !on);
      newBtn.setAttribute('aria-expanded', String(on));
      if (on) { void findPhotos(); search.focus(); } else if (picker.contains(document.activeElement)) newBtn.focus();
    },
  };
  pages.add(page);
  picker.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); page.togglePicker(false); } });

  const grid = moEl('div', 'mo-plans-grid', { role: 'list', 'aria-label': 'Plans' });
  root.appendChild(grid);
  async function load() {
    try {
      const plans = await deps.db.all(`SELECT p.*, (SELECT COUNT(*) FROM mo_plan_variants v WHERE v.plan_id = p.id) AS variations,
        (SELECT recipe_json FROM mo_plan_variants v WHERE v.id = p.variant_id) AS kept FROM mo_plans p ORDER BY p.updated_at DESC`);
      if (disposed) return;
      const had = grid.contains(document.activeElement) && document.activeElement.getAttribute('data-px-id');
      grid.replaceChildren();
      if (!plans.length) {
        grid.appendChild(moEl('div', 'mo-practice-dim', { textContent: 'No plans yet. New Plan From Photo… starts one, or choose Plan Painting on any photo in the library.' }));
        return;
      }
      for (const p of plans) {
        const card = moEl('article', 'mo-plans-card', { role: 'listitem', 'aria-label': p.title });
        const openBtn = ui.createButton(card, { id: `media-organizer.plans.open.${p.id}`, label: `Open ${p.title}`, kind: 'ghost', command: 'media-organizer.plans.open', args: [p.id] });
        openBtn.classList.add('mo-plans-open');
        const img = moEl('img', null, { alt: '' });
        deps.thumb(img, p.photo_id);
        let colours = [];
        try { const r = JSON.parse(p.kept || '{}'); colours = [...((r.palette && r.palette.swatches) || []), ...(r.saved || []).map((c) => c.rgb)].filter(Array.isArray).slice(0, 8); } catch { colours = []; }
        const dots = moEl('div', 'mo-plans-dots', { 'aria-hidden': 'true' });
        for (const c of colours) { const s = moEl('span'); s.style.background = hexOf(c); s.title = moColourName(c).name; dots.appendChild(s); }
        openBtn.replaceChildren(img, moEl('span', 'mo-plans-card-title', { textContent: p.title }),
          moEl('span', 'mo-practice-dim', { textContent: `${p.canvas_w} × ${p.canvas_h} in · ${p.variations} variation${p.variations === 1 ? '' : 's'} · ${deps.date(p.updated_at)}` }), dots);
        const actions = moEl('div', 'mo-plans-actions');
        ui.createButton(actions, { id: `media-organizer.plans.board.${p.id}`, label: 'Open Board', size: 'sm', command: 'media-organizer.plans.board', args: [p.id] });
        ui.createIconButton(actions, { id: `media-organizer.plans.rename.${p.id}`, icon: 'pencil', title: `Rename ${p.title}…`, size: 'sm', command: 'media-organizer.plans.rename', args: [p.id] });
        ui.createIconButton(actions, { id: `media-organizer.plans.remove.${p.id}`, icon: 'trash-2', title: `Delete ${p.title}…`, size: 'sm', command: 'media-organizer.plans.remove', args: [p.id] });
        card.appendChild(actions);
        grid.appendChild(card);
      }
      if (had) { const el = grid.querySelector(`[data-px-id="${CSS.escape(had)}"]`); if (el) el.focus(); }
    } catch { /* leave empty */ }
  }
  document.addEventListener('mo:plans-changed', load);
  void load();
  return { dispose() { disposed = true; pages.delete(page); clearTimeout(t); document.removeEventListener('mo:plans-changed', load); container.replaceChildren(); } };
}
