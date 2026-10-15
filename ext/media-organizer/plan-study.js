// plan-study.js — the plan's Colour step. The colour masses are the palette:
// big shapes of one colour each (study-math.js), each listed with its share
// of the picture, whether it is warmer or cooler than the rest, and how to mix
// it from the painter's own paints. Click a shape on the picture to find its
// colour in the list; open a colour to read its recipe; Shift-click two to
// compare them in a painter's words. The eyedropper (plan-colours.js) adds
// colours picked by hand to the same list.
//
// The settings live in the recipe (`study`), so each variation keeps its own.
// The picture is analysed at a working size once per edit; a setting only
// redraws the masses. With Before And After on, the masses cover the after
// side and the photo shows on the before side.

import { moEl } from './dom.js';
import { moPointKeys } from './keys.js';
import { moColourName, moMixRecipes, moOklab } from './colour.js';
import { moPlanPaintSet } from './plan-colours.js';
import { moPlanChoice, moPlanHint, moPlanSection, moPlanSlider, moPlanSwitch, moSquintAt, moSquintPos, moSquintText } from './plan-kit.js';
import { moStudyAnalyse, moStudyCompare, moStudyHue, moStudyIntensity, moStudyLight, moStudyMassNames, moStudyMasses, moStudyNormalize, moStudyValue, moStudyWarmth } from './study-math.js';

const WORK = 560;   // the long side the picture is analysed at
const ACTIONS = ['studyRow', 'studyPick', 'studyCopyRecipe', 'studyRemovePicked', 'studyPin', 'studyPaints'];
const hexOf = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const pct = (v) => `${Math.round(v * 100)}%`;
const recipeText = (rec) => (rec.paints.length === 1 ? `${rec.paints[0].name} on its own` : rec.paints.map((p) => (p.touch ? `a touch of ${p.name}` : `${p.parts} part${p.parts === 1 ? '' : 's'} ${p.name}`)).join(', '));

/** The masses of a picture's pixels drawn with a recipe's settings (the board and thumbnails use it). */
export function moPlanMassesPixels(px, w, h, recipe, under) {
  const s = moStudyNormalize(recipe && recipe.study);
  return moStudyMasses(moStudyAnalyse(px, w, h), Object.assign({}, s.masses, { under, keep: s.keep })).pixels;
}

const open = new Set();
let lastUsed = null;
const inUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanStudyActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = inUse(); return p ? p.act(a, ...args) : undefined; }));
}

/**
 * ctx: { api, state, root, frame, editedPixels(maxSide) -> { px, w, h } | null, afterRecipeChange(record, keepPanel),
 *   setTool(id), getSetting, setSetting, under() -> the underpainting paint as OKLab, or null, underName(),
 *   picker: { on(), set(on), size(), setSize(px) }, panBy(dx, dy), addToBoard(label), myPaints() }.
 * The editor calls panel() for the step and sync() after every draw.
 */
export function moPlanStudy(ctx) {
  const { api, state } = ctx;
  const ui = api.ui;
  const io = { getSetting: ctx.getSetting, setSetting: ctx.setSetting };
  let P = null; let pKey = '';         // the analysed picture, and the edit it was made from
  let shown = null; let shownKey = ''; // the masses drawn, and the settings they were drawn with
  let openKey = null;                  // the colour opened in the list: 'm<j>' or 'p<i>'
  let marked = [];                     // up to two colours to compare
  let cursor = null;                   // the keyboard's point on the picture
  let paints = null;
  let mod = false;                     // Shift or Ctrl was held on the last press in the list
  let list = null;                     // the panel's colour list, while shown
  void moPlanPaintSet(io).then((p) => { paints = p; if (state.tool === 'colour') ctx.afterRecipeChange(false, false); }).catch(() => {});

  // ── on the picture: the masses, and the layer that takes clicks and keys ──
  const canvas = moEl('canvas', 'mo-ps-lens mo-hidden', { 'aria-hidden': 'true' });
  const marks = moEl('div', 'mo-ps-marks', { 'aria-hidden': 'true' });
  const layer = moEl('div', 'mo-pc-layer mo-ps-layer mo-hidden');
  ctx.frame.append(canvas, marks, layer);
  const disposers = [];
  disposers.push(moPointKeys(layer, 'Picture. Arrow keys move a point, Enter finds the colour under it in the palette.', {
    move: (dx, dy) => { cursor = cursor || { u: 0.5, v: 0.5 }; cursor = { u: Math.max(0, Math.min(1, cursor.u + dx * 0.01)), v: Math.max(0, Math.min(1, cursor.v + dy * 0.01)) }; drawMarks(); },
    take: () => findAt(cursor || { u: 0.5, v: 0.5 }),
  }));
  // A click finds the shape's colour; a drag moves the picture.
  let down = null;
  const uvOf = (e) => { const r = layer.getBoundingClientRect(); let u = (e.clientX - r.left) / Math.max(1, r.width); if (state.mirror) u = 1 - u; return { u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))) }; };
  const press = ui.onDragPress(layer, (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    try { layer.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
  }, { pointerEvents: true });
  disposers.push(() => press.dispose());
  const onMove = (e) => {
    if (!down || down.id !== e.pointerId) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
    if (down.moved) { ctx.panBy(e.clientX - down.lx, e.clientY - down.ly); down.lx = e.clientX; down.ly = e.clientY; }
  };
  const onUp = (e) => { const d = down; down = null; if (d && !d.moved && d.id === e.pointerId) findAt(uvOf(e)); };
  layer.addEventListener('pointermove', onMove); layer.addEventListener('pointerup', onUp); layer.addEventListener('pointercancel', () => { down = null; });

  const study = () => moStudyNormalize(state.recipe && state.recipe.study);
  const opts = () => { const s = study(); return Object.assign({}, s.masses, { under: ctx.under(), keep: s.keep }); };
  function setStudy(change, record, keepPanel) {
    const s = study();
    state.recipe.study = Object.assign(s, change, change.masses ? { masses: Object.assign(s.masses, change.masses) } : {});
    if (record) { const L = lens(); if (L) state.recipe.palette.swatches = L.masses.filter((m) => m.share >= 0.005).slice(0, 16).map((m) => m.rgb); }
    ctx.afterRecipeChange(record, keepPanel);
  }
  function drawMarks() {
    marks.replaceChildren();
    const put = (u, v, text, cls) => { const m = moEl('span', `mo-ps-spot${cls ? ` ${cls}` : ''}`, { textContent: text }); m.style.left = pct(u); m.style.top = pct(v); marks.appendChild(m); };
    if (cursor && document.activeElement === layer) put(cursor.u, cursor.v, '', 'mo-ps-spot--cursor');
  }

  // ── the analysis and the masses ──
  function analysed() {
    const key = editKey();
    if (P && key === pKey) return P;
    const got = ctx.editedPixels(WORK);
    if (!got) return null;
    P = moStudyAnalyse(got.px, got.w, got.h); pKey = key; shownKey = ''; openKey = null; marked = [];
    return P;
  }
  const selJ = () => (openKey && openKey[0] === 'm' ? Number(openKey.slice(1)) : -1);
  const editKey = () => JSON.stringify(Object.assign({}, state.recipe, { study: null, saved: null, palette: null, overlays: null, stage: null, show: null, blur: null, levels: null, notan: null, grey: null }));
  // Whether the masses for the settings now are already worked out.
  const ready = () => !!P && !!shown && pKey === editKey() && shownKey === `${pKey}|${JSON.stringify(opts())}|${selJ()}`;
  // The masses take a moment on a new picture or new settings: the photo is drawn first and they follow
  // in the next frame, the masses before them staying on screen meanwhile.
  let laterTimer = 0, panelWaiting = false, seenTool = null;
  // True when the masses are ready, worked out now if this step has shown them before; false on coming in.
  function needNow() {
    if (ready()) { seenTool = state.tool; return true; }
    if (seenTool === state.tool) { lens(); return true; }
    return false;
  }
  function later(forPanel) {
    if (forPanel) panelWaiting = true;
    if (laterTimer) return;
    laterTimer = setTimeout(() => {
      laterTimer = 0;
      if (!state.recipe) return;
      lens(); seenTool = state.tool;
      if (panelWaiting) { panelWaiting = false; ctx.afterRecipeChange(false, false); } else ctx.requestRender();
    }, 16);
  }
  function lens() {
    const A = analysed();
    if (!A) return null;
    const o = opts(), key = `${pKey}|${JSON.stringify(o)}|${selJ()}`;
    if (shown && key === shownKey) return shown;
    const m = moStudyMasses(A, o, selJ());
    shown = Object.assign({ names: moStudyMassNames(m.masses) }, m); shownKey = key;
    canvas.width = A.w; canvas.height = A.h;
    canvas.getContext('2d').putImageData(new ImageData(m.pixels, A.w, A.h), 0, 0);
    return shown;
  }
  function findAt(p) {
    const L = lens();
    if (!L) return;
    const j = L.labels[Math.round(p.v * (P.h - 1)) * P.w + Math.round(p.u * (P.w - 1))];
    const key = `m${j}`;
    openKey = openKey === key ? null : key; marked = openKey ? [openKey] : [];
    ctx.afterRecipeChange(false, false);
    if (openKey) queueMicrotask(() => queueMicrotask(() => { const row = list && list.querySelector(`[data-key="${key}"]`); if (row) row.scrollIntoView({ block: 'nearest' }); }));
  }

  /** After every draw: the masses over the picture on Colour, and on Transfer when Colour is the view. */
  function sync() {
    const on = !!state.recipe && (state.tool === 'colour' || (state.tool === 'transfer' && state.view === 'colour'));
    const clicks = on && state.tool === 'colour' && !ctx.picker.on();
    layer.classList.toggle('mo-hidden', !clicks);
    marks.classList.toggle('mo-hidden', !clicks);
    if (!on) { canvas.classList.add('mo-hidden'); return; }
    if (clicks && layer.tabIndex !== 0) layer.tabIndex = 0;
    if (needNow()) canvas.classList.remove('mo-hidden'); else { later(false); canvas.classList.toggle('mo-hidden', !(shown && pKey === editKey())); }
    canvas.style.clipPath = state.split >= 0 ? `inset(0 0 0 ${pct(state.split)})` : '';
    drawMarks();
  }

  // ── the panel ──
  function colours() {
    const L = ready() ? shown : null;
    const out = [];
    if (L) L.masses.forEach((m, k) => { if (m.share >= 0.003) out.push({ key: `m${m.j}`, name: L.names[k], rgb: m.rgb, lab: m.lab, share: m.share, temp: m.temp, value: m.value, intensity: m.intensity }); });
    (state.recipe.saved || []).forEach((c, i) => {
      const lab = moOklab(c.rgb[0], c.rgb[1], c.rgb[2]);
      out.push({ key: `p${i}`, name: moColourName(c.rgb).name, rgb: c.rgb, lab, picked: true, value: moStudyValue(...c.rgb.map(Math.round)), intensity: moStudyIntensity(lab[1], lab[2]) });
    });
    return out;
  }
  let mixes = { of: null, map: new Map() }; // the mixes found, for the paints they were found with
  const mixOf = (rgb) => {
    if (!paints) return null;
    if (mixes.of !== paints) mixes = { of: paints, map: new Map() };
    const k = rgb.map(Math.round).join(',');
    if (!mixes.map.has(k)) mixes.map.set(k, moMixRecipes(rgb, paints.paints, paints.rules));
    return mixes.map.get(k);
  };
  function mixBar(rec, cls) {
    const bar = moEl('span', cls, { 'aria-hidden': 'true' });
    const top = Math.max(...rec.paints.map((p) => p.parts));
    for (const p of rec.paints) { const s = moEl('span'); s.style.background = p.hex; s.style.flex = String(p.touch ? top * 0.08 : p.parts); bar.appendChild(s); }
    return bar;
  }
  function panel(container, panelDisposers) {
    const s = study(), m = s.masses;
    const s1 = moPlanSection(container, 'Masses');
    if (ctx.isolate) ctx.isolate.control(s1, panelDisposers);
    moPlanSlider(s1, { id: 'media-organizer.plan.study.massCount', label: 'Masses', min: 2, max: 48, step: 1, value: m.n, onInput: (v) => { openKey = null; marked = []; setStudy({ masses: { n: v } }, false, true); }, onChange: (v) => setStudy({ masses: { n: v } }, true, false) });
    moPlanSlider(s1, { id: 'media-organizer.plan.study.massSquint', label: 'Squint', min: 0, max: 100, step: 1, value: moSquintPos(m.squint), text: (v) => moSquintText(moSquintAt(v)), onInput: (v) => { openKey = null; marked = []; setStudy({ masses: { squint: moSquintAt(v) } }, false, true); }, onChange: (v) => setStudy({ masses: { squint: moSquintAt(v) } }, true, false) });
    moPlanSlider(s1, { id: 'media-organizer.plan.study.massAmount', label: 'Colour amount', min: 0, max: 100, step: 5, value: m.amount, text: (v) => (v ? `${v}%` : ctx.underName() || 'grey'), onInput: (v) => setStudy({ masses: { amount: v } }, false, true), onChange: (v) => setStudy({ masses: { amount: v } }, true, false) });
    moPlanChoice(ui, s1, { id: 'media-organizer.plan.study.massColour', ariaLabel: 'A mass’s colour', items: [['dominant', 'Local Colour'], ['average', 'Average']], value: m.colour, onChange: (v) => setStudy({ masses: { colour: v } }, true, true) }, panelDisposers);
    moPlanSwitch(ui, s1, { id: 'media-organizer.plan.study.temp', label: 'Show warm and cool', checked: m.temp, onChange: (on) => setStudy({ masses: { temp: on, strong: on ? false : m.strong } }, true) }, panelDisposers);
    moPlanSwitch(ui, s1, { id: 'media-organizer.plan.study.strong', label: 'Show only strong colour', checked: m.strong, onChange: (on) => setStudy({ masses: { strong: on, temp: on ? false : m.temp } }, true) }, panelDisposers);
    if (m.strong) moPlanSlider(s1, { id: 'media-organizer.plan.study.keep', label: 'Stronger than', min: 0, max: 14, step: 0.5, value: s.keep, onInput: (v) => setStudy({ keep: v }, false, true), onChange: (v) => setStudy({ keep: v }, true, true) });

    const s2 = moPlanSection(container, '', true);
    const head = moEl('div', 'mo-pc-head');
    head.appendChild(moEl('div', 'mo-practice-section-title', { textContent: 'Palette' }));
    const pick = ui.createIconButton(head, { id: 'media-organizer.plan.studyPick', icon: 'pipette', title: ctx.picker.on() ? 'Stop Picking Colours' : 'Pick Colours From The Picture', size: 'sm', command: 'media-organizer.plan.studyPick' });
    pick.setAttribute('aria-pressed', String(ctx.picker.on()));
    s2.appendChild(head);
    if (ctx.picker.on()) {
      moPlanSlider(s2, { id: 'media-organizer.plan.pickSize', label: 'Picker size', min: 1, max: 45, step: 2, value: ctx.picker.size(), text: (v) => `${v} px`, onInput: (v) => ctx.picker.setSize(v), onChange: (v) => ctx.picker.setSize(v) });
      moPlanHint(s2, 'Click the picture to add the colour under the picker. A bigger picker averages more, the way the eye reads a patch.');
    }
    list = moEl('div', 'mo-ps-pal', { role: 'group', 'aria-label': 'Palette: open a colour for its mix, Shift and open a second to compare' });
    const onMods = (e) => { mod = !!(e.shiftKey || e.ctrlKey || e.metaKey); };
    list.addEventListener('pointerdown', onMods, true); list.addEventListener('keydown', onMods, true);
    panelDisposers.push(() => { list = null; });
    if (!needNow()) { later(true); moPlanHint(list, 'Working out the masses…'); }
    const all = colours(), counts = new Map();
    for (const c of all) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    for (const c of all) {
      const isOpen = openKey === c.key, isMarked = marked.includes(c.key);
      const name = counts.get(c.name) > 1 && c.picked ? `${c.name} · value ${c.value.toFixed(1)}` : c.name;
      const b = ui.createButton(list, { id: `media-organizer.plan.study.colour.${c.key}`, label: name, kind: 'ghost', size: 'sm', command: 'media-organizer.plan.studyRow', args: [c.key] });
      b.classList.add('mo-ps-prow'); b.dataset.key = c.key;
      b.setAttribute('aria-pressed', String(isOpen || isMarked)); b.setAttribute('aria-expanded', String(isOpen));
      const sw = moEl('span', 'mo-ps-sw', { 'aria-hidden': 'true' }); sw.style.background = hexOf(c.rgb);
      b.prepend(sw);
      const num = moEl('span', 'mo-ps-num');
      if (c.temp) num.appendChild(moEl('span', `mo-ps-tw is-${c.temp}`, { textContent: c.temp }));
      num.appendChild(document.createTextNode(c.picked ? 'picked' : pct(c.share)));
      b.appendChild(num);
      const mx = mixOf(c.rgb);
      if (mx && mx.best && !isOpen) b.appendChild(mixBar(mx.best, 'mo-ps-mixbar'));
      if (isOpen) list.appendChild(recipeBlock(c, mx));
    }
    s2.appendChild(list);
    const cmp = moEl('div', 'mo-ps-cmp');
    if (marked.length === 2) compareBlock(cmp, all.find((c) => c.key === marked[0]), all.find((c) => c.key === marked[1]));
    else moPlanHint(cmp, 'Click a shape on the picture to find its colour here. Shift and click two colours to compare them.');
    s2.appendChild(cmp);
    const row = moEl('div', 'mo-plan-row');
    ui.createButton(row, { id: 'media-organizer.plan.studyPaints', label: 'My Paints…', size: 'sm', command: 'media-organizer.plan.studyPaints' });
    ui.createButton(row, { id: 'media-organizer.plan.studyPin', label: 'Pin Colours To Board', size: 'sm', command: 'media-organizer.plan.studyPin' });
    s2.appendChild(row);
  }
  function recipeBlock(c, mx) {
    const box = moEl('div', 'mo-ps-recipe');
    const best = mx && mx.best;
    if (!best) { moPlanHint(box, paints ? 'Your paints cannot mix this. Add a paint near it in My Paints.' : 'Reading your paints'); return box; }
    box.appendChild(mixBar(best, 'mo-ps-mixbar mo-ps-mixbar--lg'));
    const ul = moEl('ul', 'mo-ps-parts');
    for (const p of best.paints) {
      const li = moEl('li');
      const dot = moEl('span', 'mo-pc-dot', { 'aria-hidden': 'true' }); dot.style.background = p.hex;
      li.append(dot, moEl('span', null, { textContent: p.name }), moEl('b', null, { textContent: best.paints.length === 1 ? 'on its own' : p.touch ? 'a touch' : `${p.parts} part${p.parts === 1 ? '' : 's'}` }));
      ul.appendChild(li);
    }
    box.appendChild(ul);
    const match = moEl('div', 'mo-ps-match');
    for (const hx of [hexOf(c.rgb), best.hex]) { const s = moEl('span', 'mo-ps-sw', { 'aria-hidden': 'true' }); s.style.background = hx; match.appendChild(s); }
    match.appendChild(moEl('span', `mo-pc-close mo-pc-close--${best.closeness.toLowerCase().replace(/\s+/g, '-')}`, { textContent: best.closeness }));
    match.appendChild(moEl('span', 'mo-practice-dim', { textContent: `value ${c.value.toFixed(1)} · intensity ${c.intensity.toFixed(1)}` }));
    box.appendChild(match);
    if (mx.simpler) moPlanHint(box, `Fewer paints: ${recipeText(mx.simpler)} (${mx.simpler.closeness.toLowerCase()}).`);
    const acts = moEl('div', 'mo-plan-row');
    ui.createButton(acts, { id: 'media-organizer.plan.studyCopyRecipe', label: 'Copy Recipe', icon: 'copy', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.studyCopyRecipe', args: [c.key] });
    if (c.picked) ui.createButton(acts, { id: 'media-organizer.plan.studyRemovePicked', label: 'Remove', icon: 'trash-2', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.studyRemovePicked', args: [c.key] });
    box.appendChild(acts);
    return box;
  }
  function compareBlock(parent, a, b) {
    if (!a || !b) return;
    const spot = (c) => ({ value: c.value, warm: moStudyWarmth(c.lab[1], c.lab[2]), intensity: c.intensity, hue: moStudyHue(c.lab[1], c.lab[2]), rgb: c.rgb });
    const ab = moEl('div', 'mo-ps-ab', { 'aria-hidden': 'true' });
    for (const [c, t] of [[a, 'A'], [b, 'B']]) { const s = moEl('span', null, { textContent: t }); s.style.background = hexOf(c.rgb); ab.appendChild(s); }
    parent.appendChild(ab);
    const ul = moEl('ul', 'mo-ps-compare');
    for (const t of [`A is ${a.name}, B is ${b.name}.`, ...moStudyCompare(spot(a), spot(b))]) ul.appendChild(moEl('li', null, { textContent: t }));
    parent.appendChild(ul);
  }

  const find = (key) => colours().find((c) => c.key === key);
  const acts = {
    studyRow(key) {
      if (mod) { marked = marked.includes(key) ? marked.filter((k) => k !== key) : [...marked, key].slice(-2); }
      else { openKey = openKey === key ? null : key; marked = openKey ? [openKey] : []; }
      mod = false;
      ctx.afterRecipeChange(false, false);
    },
    studyPick() { ctx.picker.set(!ctx.picker.on()); ctx.afterRecipeChange(false, false); },
    async studyCopyRecipe(key) {
      const c = find(key), mx = c && mixOf(c.rgb);
      if (!mx || !mx.best) return;
      try { await navigator.clipboard.writeText(`${c.name} (${hexOf(c.rgb).toUpperCase()}): ${recipeText(mx.best)}`); } catch { /* no clipboard */ }
    },
    studyRemovePicked(key) {
      const i = Number(String(key).slice(1));
      if (!String(key).startsWith('p') || !state.recipe.saved[i]) return;
      state.recipe.saved = state.recipe.saved.filter((_, k) => k !== i);
      openKey = null; marked = [];
      ctx.afterRecipeChange(true);
    },
    studyPin() { const L = lens(); if (L) state.recipe.palette.swatches = L.masses.filter((m) => m.share >= 0.005).slice(0, 16).map((m) => m.rgb); ctx.addToBoard('This Palette'); },
    studyPaints() { ctx.myPaints(); },
  };
  const handle = { root: ctx.root, act: (name, ...args) => (acts[name] && state.recipe ? acts[name](...args) : undefined) };
  open.add(handle);
  const used = () => { lastUsed = handle; };
  ctx.root.addEventListener('focusin', used);

  return {
    panel,
    sync,
    /** The masses as drawn now, for Transfer's export: a canvas the size of the analysis. */
    massesCanvas: () => (lens() ? canvas : null),
    /** Values: where light ends by the picture's own split (a value, 0 to 10), and the two families' colours. */
    lightSplit: () => { const A = analysed(); return A ? Math.round(A.split * 2) / 2 : null; },
    lightFamilies: (split) => { const A = analysed(); if (!A) return null; const L = moStudyLight(A, split == null ? A.split : split, 'colours'); return { families: L.families, warmer: L.warmer }; },
    dispose() {
      clearTimeout(laterTimer);
      open.delete(handle); if (lastUsed === handle) lastUsed = null;
      ctx.root.removeEventListener('focusin', used);
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
      canvas.remove(); marks.remove(); layer.remove();
    },
  };
}
