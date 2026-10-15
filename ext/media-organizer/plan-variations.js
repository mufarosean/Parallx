// plan-variations.js — a painting plan's variations. The controls are the plan's
// working picture (mo_plans.draft_json), kept as they change; a variation is a
// picture saved from it (mo_plan_variants) and stays as it was saved. From any
// tool: Save As Variation keeps the picture and goes on from it, Start Over puts
// the untouched photo, whole and uncropped, in the controls. Opening a variation
// puts it in the controls, and what is changed from then on is kept in it as it
// changes; Undo goes back to what was there. Right-click a variation (or
// Shift+F10) for its own actions. The saved variations are what the board lays
// out (board.js).

import { moEl } from './dom.js';
import { moPlanStages } from './plan-colours.js';

const open = new Set();
let lastUsed = null;
const ACTIONS = ['saveVariation', 'startOver', 'openVariation', 'variationMenu', 'addToBoardMenu'];
const inUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanVariationsActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = inUse(); return p ? p.act(a, ...args) : undefined; }));
}

const clone = (r) => JSON.parse(JSON.stringify(r));
// Which view a picture is on (photo, values, colour) is not a change to it.
const same = (a, b) => JSON.stringify({ ...a, show: 0 }) === JSON.stringify({ ...b, show: 0 });
function nextName(variants) {
  const names = new Set(variants.map((v) => v.name));
  let n = variants.length + 1;
  while (names.has(`Variation ${n}`)) n++;
  return `Variation ${n}`;
}

/**
 * ctx: { api, db, planId, root, bar, state, io: { getSetting, setSetting },
 *   normalize(recipe), startRecipe() -> the untouched photo's recipe,
 *   apply(recipe, from) puts a recipe in the controls as an undo step,
 *   record() adds an undo step for the source, saveDraft(), thumb(recipe) -> data URL or '',
 *   boardItems(variation?) -> the Add To Board menu, for the open variation or the one named, view() -> the view on screen, showStep(view) opens a variation's view }.
 * The editor calls sync() after every change and render() when the source changes.
 */
export function moPlanVariations(ctx) {
  const { api, db, planId, state, bar } = ctx;
  const ui = api.ui;
  const thumbs = new Map(); // variation id -> { key, url }
  let savedId = null; // the variation just saved, while the picture is still it
  let boardBtn = null, moreBtn = null, keepTimer = 0;
  const list = moEl('div', 'mo-pv-list', { role: 'group', 'aria-label': 'Saved variations' });
  const status = moEl('div', 'mo-practice-dim mo-pv-status', { role: 'status' });
  const actions = moEl('div', 'mo-plan-variant-actions');
  bar.replaceChildren(list, status, actions);

  const dirty = () => !!state.variant && !!state.recipe && !same(state.recipe, state.variant.recipe);
  const touch = () => document.dispatchEvent(new CustomEvent('mo:plans-changed'));
  function thumbOf(v) {
    const key = JSON.stringify(v.recipe), t = thumbs.get(v.id);
    if (t && t.key === key) return t.url;
    const url = ctx.thumb(v.recipe) || '';
    thumbs.set(v.id, { key, url });
    return url;
  }
  function statusText() {
    if (state.variant && state.variant.id === savedId) return `${state.variant.name} saved`;
    if (state.variant) return `Editing ${state.variant.name} · saves as you go`;
    return state.variants.length ? 'Not saved as a variation' : '+ saves this picture as a variation';
  }

  function render() {
    if (!state.plan) return;
    const had = bar.contains(document.activeElement) && document.activeElement.getAttribute('data-px-id');
    list.replaceChildren(); actions.replaceChildren();
    for (const v of state.variants) {
      const on = !!state.variant && state.variant.id === v.id;
      const b = ui.createButton(list, { id: `media-organizer.plan.variation.${v.id}`, label: v.name, kind: 'ghost', size: 'sm', command: 'media-organizer.plan.openVariation', args: [v.id], title: `Open ${v.name}` });
      b.classList.add('mo-plan-variant'); b.classList.toggle('is-current', on); b.setAttribute('aria-pressed', String(on));
      b.prepend(moEl('img', null, { alt: '', src: thumbOf(v) }));
      if (state.plan.variant_id === v.id) b.appendChild(moEl('span', 'mo-plan-variant-tag', { textContent: 'For export' }));
      b.setAttribute('aria-haspopup', 'menu');
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(v, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : b); });
    }
    ui.createIconButton(list, { id: 'media-organizer.plan.saveVariation', icon: 'plus', title: 'Save As Variation: keep the picture as it is now and go on from it', command: 'media-organizer.plan.saveVariation' }).classList.add('mo-pv-add');
    boardBtn = null;
    moreBtn = ui.createIconButton(actions, { id: 'media-organizer.plan.variationMenu', icon: 'ellipsis', title: 'More: Start Over, Add To Board, Rename, Remove', size: 'sm', command: 'media-organizer.plan.variationMenu' });
    moreBtn.setAttribute('aria-haspopup', 'menu');
    sync();
    if (had) {
      const back = Array.from(bar.querySelectorAll('[data-px-id]')).find((el) => el.getAttribute('data-px-id') === had && !el.disabled);
      (back || actions.querySelector('button')).focus();
    }
  }
  function sync() {
    const d = dirty();
    if (d || !state.variant || state.variant.id !== savedId) savedId = null;
    status.textContent = statusText();
    clearTimeout(keepTimer);
    if (d) keepTimer = setTimeout(() => void keepChanges(), 600);
  }
  // The open variation takes the picture's changes once the hand rests; its view (photo, values, colour) stays the one it was saved on.
  async function keepChanges() {
    clearTimeout(keepTimer);
    const v = state.variant;
    if (!v || !dirty()) return;
    v.recipe = Object.assign(clone(state.recipe), { show: v.recipe.show });
    await db.run('UPDATE mo_plan_variants SET recipe_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(v.recipe), new Date().toISOString(), v.id]);
    const b = Array.from(list.querySelectorAll('[data-px-id]')).find((el) => el.getAttribute('data-px-id') === `media-organizer.plan.variation.${v.id}`);
    const pic = b && b.querySelector('img');
    if (pic) pic.src = thumbOf(v);
    touch();
  }

  async function keep(v) {
    state.plan.variant_id = v ? v.id : null;
    await db.run('UPDATE mo_plans SET variant_id = ?, updated_at = ? WHERE id = ?', [state.plan.variant_id, new Date().toISOString(), planId]);
  }
  const acts = {
    async saveVariation() {
      if (!state.recipe) return;
      state.recipe.show = ctx.view(); // a variation saved from Values is its values, from Colour its masses
      const name = nextName(state.variants), recipe = clone(state.recipe), position = state.variants.length;
      const res = await db.run('INSERT INTO mo_plan_variants (plan_id, name, recipe_json, position) VALUES (?, ?, ?, ?)', [planId, name, JSON.stringify(recipe), position]);
      const v = { id: res.lastInsertRowid, plan_id: planId, name, position, recipe };
      state.variants.push(v); state.variant = v; savedId = v.id;
      if (!state.variants.some((x) => x.id === state.plan.variant_id)) await keep(v);
      ctx.record(); ctx.saveDraft(); render(); touch();
    },
    async startOver() { if (state.recipe) { await keepChanges(); ctx.apply(ctx.startRecipe(), null); render(); } },
    // The open one stays as it is (its changes are kept); another is put in the controls.
    async openVariation(id) {
      const v = state.variants.find((x) => x.id === id);
      if (!v) return;
      await keepChanges();
      if (state.variant !== v) { ctx.apply(clone(v.recipe), v); render(); }
      ctx.showStep(v.recipe.show);
    },
    addToBoardMenu() { const at = boardBtn || moreBtn; if (at) ui.createMenu(at, { id: 'media-organizer.plan.addToBoard', label: 'Add To Board', items: ctx.boardItems() }); },
    variationMenu() {
      const v = state.variant;
      if (!moreBtn) return;
      ui.createMenu(moreBtn, { id: 'media-organizer.plan.variationActions', label: 'More Variation Actions', items: [
        { label: 'Start Over', icon: 'rotate-ccw', tooltip: 'Every control back to the untouched photo, crop included. Undo brings the picture back.', onSelect: () => acts.startOver() },
        { label: 'Add To Board', icon: 'layout-dashboard', submenu: ctx.boardItems() },
        { separator: true },
        { label: v ? `Rename ${v.name}…` : 'Rename…', disabled: !v, onSelect: () => void rename(v) },
        { label: 'Use For Export', disabled: !v || state.plan.variant_id === v.id, onSelect: () => void keep(v).then(() => { render(); touch(); }) },
        { label: 'Make Stage Variations', onSelect: () => void stageVariations() },
        { label: v ? `Remove ${v.name}…` : 'Remove Variation…', disabled: !v, onSelect: () => void remove(v) },
      ] });
    },
  };
  // A variation's own menu (right-click, or Shift+F10 on it).
  function itemMenu(v, at) {
    ui.createMenu(at, { id: 'media-organizer.plan.variationItem', label: `${v.name} Actions`, items: [
      { label: 'Open', icon: 'image', disabled: state.variant === v, onSelect: () => void acts.openVariation(v.id) },
      { label: 'Rename…', icon: 'pencil', onSelect: () => void rename(v) },
      { label: 'Duplicate', icon: 'copy', onSelect: () => void duplicate(v) },
      { label: 'Use For Export', icon: 'download', disabled: state.plan.variant_id === v.id, onSelect: () => void keep(v).then(() => { render(); touch(); }) },
      { label: 'Add To Board', icon: 'layout-dashboard', submenu: ctx.boardItems(v) },
      { separator: true },
      { label: 'Remove…', icon: 'trash-2', onSelect: () => void remove(v) },
    ] });
  }
  async function duplicate(v) {
    await keepChanges();
    const names = new Set(state.variants.map((x) => x.name));
    let name = `${v.name} Copy`.slice(0, 40), n = 2;
    while (names.has(name)) name = `${v.name} Copy ${n++}`.slice(0, 40);
    const recipe = clone(v.recipe), position = state.variants.length;
    const res = await db.run('INSERT INTO mo_plan_variants (plan_id, name, recipe_json, position) VALUES (?, ?, ?, ?)', [planId, name, JSON.stringify(recipe), position]);
    state.variants.push({ id: res.lastInsertRowid, plan_id: planId, name, position, recipe });
    render(); touch();
  }
  async function rename(v) {
    const name = v && await api.window.showInputBox({ prompt: 'Name this variation', value: v.name });
    if (!name || !String(name).trim()) return;
    v.name = String(name).trim().slice(0, 40);
    await db.run('UPDATE mo_plan_variants SET name = ? WHERE id = ?', [v.name, v.id]);
    render(); touch();
  }
  // One variation per stage, named after it: the picture with its stage's squint and values. Existing names are left alone.
  async function stageVariations() {
    const stages = await moPlanStages(ctx.io);
    for (const [i, s] of stages.entries()) {
      if (state.variants.some((v) => v.name === s.name)) continue;
      const recipe = ctx.normalize(Object.assign(clone(state.recipe), { stage: i + 1, blur: s.blur, levels: s.levels, grey: s.grey, notan: s.notan }));
      const res = await db.run('INSERT INTO mo_plan_variants (plan_id, name, recipe_json, position) VALUES (?, ?, ?, ?)', [planId, s.name, JSON.stringify(recipe), state.variants.length]);
      state.variants.push({ id: res.lastInsertRowid, plan_id: planId, name: s.name, position: state.variants.length, recipe });
    }
    if (!state.variants.some((x) => x.id === state.plan.variant_id) && state.variants.length) await keep(state.variants[0]);
    render(); touch();
  }
  async function remove(v) {
    if (!v) return;
    if (state.variant === v) await keepChanges();
    const ok = await api.window.showWarningMessage(`Remove "${v.name}" from this plan? The picture stays in the controls.`, { title: 'Remove' }, { title: 'Cancel' });
    if (!ok || ok.title !== 'Remove') return;
    await db.run('DELETE FROM mo_plan_variants WHERE id = ?', [v.id]);
    state.variants = state.variants.filter((x) => x.id !== v.id);
    if (state.variant === v) state.variant = null;
    thumbs.delete(v.id);
    if (state.plan.variant_id === v.id) await keep(state.variants[0] || null);
    ctx.record(); ctx.saveDraft(); render(); touch();
  }

  const handle = { root: ctx.root, act: (a, ...args) => (acts[a] ? acts[a](...args) : undefined) };
  open.add(handle);
  const used = () => { lastUsed = handle; };
  ctx.root.addEventListener('focusin', used);
  return {
    render,
    sync,
    dispose() { void keepChanges(); open.delete(handle); if (lastUsed === handle) lastUsed = null; ctx.root.removeEventListener('focusin', used); },
  };
}
