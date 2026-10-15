// plan-colours.js — Painting Plans' stages (squint and values in one press),
// the colour picker, saved colours with their names and paint mixes, and the
// painter's own paints and mixing rules. main.js's plan editor hands in its
// state and helpers (moPlanColours) and calls sync() after each draw.
//
// Stages, paints, rules and the picker size are the painter's, kept in
// mo_settings for every plan; saved colours belong to a variation's recipe
// (`saved`: { rgb, x, y }, x and y in the turned picture, 0..1, or null for a
// colour that came from the palette).

import { moEl, moSlug } from './dom.js';
import { moPointKeys, moSliderKeys } from './keys.js';
import { moPlanHint, moPlanSection, moPlanSlider, moPlanSwitch, moSquintAt, moSquintPos, moSquintText } from './plan-kit.js';
import { MO_COMMON_PAINTS, MO_MIX_RULES, MO_STARTER_PAINTS, moColourName, moHexRgb } from './colour.js';

const STAGES_KEY = 'plan_stages_v1';
const PAINTS_KEY = 'plan_paints_v1';
const PICK_KEY = 'plan_pick_v1';
export const MO_PLAN_STAGES = [
  { name: 'Block In', blur: 0.6, levels: 3, grey: false, notan: 0 },
  { name: 'Big Shapes', blur: 0.3, levels: 5, grey: false, notan: 0 },
  { name: 'Detail', blur: 0, levels: 0, grey: false, notan: 0 },
];
const MAX_STAGES = 9;
const hexOf = (rgb) => '\u0023' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const aidsOff = (r) => !(r.blur > 0) && !(r.levels >= 2) && !r.grey && !(r.notan > 0);
const stageSummary = (s) => [s.blur > 0 ? `squint ${Math.round(s.blur * 1000) / 10}%` : 'no squint', s.notan > 0 ? 'light and shadow' : s.levels >= 2 ? `${s.levels} values` : 'all values'].join(', ');
// The underpainting paints offered in Values ('' is grey).
const MO_PLAN_UNDERS = ['', 'Burnt Sienna', 'Raw Umber', 'Burnt Umber', 'Yellow Ochre', 'Ultramarine Blue', 'Payne’s Grey', 'Sap Green'];
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; } };

// The painter's settings, shared by every open plan.
const shared = { stages: MO_PLAN_STAGES.map((s) => ({ ...s })), paints: MO_STARTER_PAINTS.map((p) => ({ ...p })), paintsSet: false, rules: { ...MO_MIX_RULES }, pickSize: 9, pins: true, loading: null };
function loadShared(io) {
  if (!shared.loading) {
    shared.loading = (async () => {
      const st = parse(await io.getSetting(STAGES_KEY, ''), null);
      if (Array.isArray(st) && st.length) shared.stages = st.slice(0, MAX_STAGES).map((s, i) => ({ name: String(s.name || `Stage ${i + 1}`), blur: Math.max(0, Math.min(1, Number(s.blur) || 0)), levels: Math.max(0, Math.min(8, Math.round(Number(s.levels) || 0))), grey: !!s.grey, notan: Math.max(0, Math.min(0.95, Number(s.notan) || 0)) }));
      const pt = parse(await io.getSetting(PAINTS_KEY, ''), null);
      if (pt && Array.isArray(pt.paints)) { shared.paints = pt.paints.filter((p) => p && p.name && moHexRgb(p.hex)).map((p) => ({ name: String(p.name), hex: String(p.hex) })); shared.paintsSet = true; }
      if (pt && pt.rules) shared.rules = Object.assign({}, MO_MIX_RULES, pt.rules);
      const pk = parse(await io.getSetting(PICK_KEY, ''), null);
      if (pk && Number.isFinite(Number(pk.size))) shared.pickSize = Math.max(1, Math.min(45, Math.round(Number(pk.size))));
      if (pk && typeof pk.pins === 'boolean') shared.pins = pk.pins;
    })().catch(() => {});
  }
  return shared.loading;
}
// The painter's paints and mixing rules, once loaded (the board reads them).
export async function moPlanPaintSet(io) { await loadShared(io); return { paints: shared.paints, rules: shared.rules }; }
// The stages, for a variation per stage.
export async function moPlanStages(io) { await loadShared(io); return shared.stages.map((s) => ({ ...s })); }
const saveStages = (io) => io.setSetting(STAGES_KEY, JSON.stringify(shared.stages)).catch(() => {});
const savePaints = (io) => { shared.paintsSet = true; return io.setSetting(PAINTS_KEY, JSON.stringify({ paints: shared.paints, rules: shared.rules })).catch(() => {}); };
const savePick = (io) => io.setSetting(PICK_KEY, JSON.stringify({ size: shared.pickSize, pins: shared.pins })).catch(() => {});

// ── Commands: the stage keys (1 to 9 choose a stage, 0 the picture, while a plan has the
// focus) and every action of the panels, run on the plan in use ──
const open = new Set();
let lastUsed = null;
const PLAN_ACTIONS = ['underPaint', 'stageMenu', 'renameStage', 'addStage', 'removeStage', 'myPaints', 'backFromPaints', 'customPaint', 'starterPaints', 'removePaint'];
const planInUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanColoursActivate(api) {
  const subs = [];
  let focusKey = null;
  try { focusKey = api.context.createContextKey('mediaOrganizer.planFocused', false); } catch { focusKey = null; }
  shared.focusKey = focusKey;
  for (let n = 0; n <= MAX_STAGES; n++) {
    const id = `media-organizer.plan.stage${n}`;
    subs.push(api.commands.registerCommand(id, () => { const p = planInUse(); if (p) p.stage(n); }));
    try { if (focusKey && api.keybindings) subs.push(api.keybindings.register(String(n), id, focusKey.key)); } catch { /* no shortcut */ }
  }
  for (const a of PLAN_ACTIONS) subs.push(api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = planInUse(); return p ? p.act(a, ...args) : undefined; }));
  return subs;
}

/**
 * ctx: { api, state, root, frame, afterRecipeChange(record), preview(),
 *   editedPixels(maxSide) -> { px, w, h } | null, setTool(id), getSetting, setSetting,
 *   moDropdown(options) }.
 */
export function moPlanColours(ctx) {
  const { state, api } = ctx;
  const io = { getSetting: ctx.getSetting, setSetting: ctx.setSetting };
  let view = 'list';       // the Pick Colours panel: 'list' | 'detail' | 'paints'
  let point = null;        // { u, v } on the crop, while picking
  let pressing = false;
  let cache = null;        // the edited picture's pixels, for sampling
  let readout = null;      // the panel's "Under the picker" block, while shown
  let lastMix = null;
  let pendingFocus = null; // after a view change: 'back' (the new view's Back) or 'chip' (the colour returned from)
  const disposers = [];

  // ── on the picture: the picker's layer, its loupe and the saved colours' pins ──
  const layer = moEl('div', 'mo-pc-layer mo-hidden');
  const pins = moEl('div', 'mo-pc-pins', { 'aria-hidden': 'true' });
  const loupe = moEl('div', 'mo-pc-loupe mo-hidden', { 'aria-hidden': 'true' });
  const loupeBox = moEl('div', 'mo-pc-loupe-box');
  const loupeTag = moEl('div', 'mo-pc-loupe-tag mo-hidden', { 'aria-hidden': 'true' });
  const live = moEl('div', 'mo-pc-live', { 'aria-live': 'polite' });
  loupe.appendChild(loupeBox);
  layer.append(pins, loupe, loupeTag, live);
  ctx.frame.appendChild(layer);
  // Marks around and on the picture: the transfer grid's labels in the margin, Compare's split.
  const marks = moEl('div', 'mo-pc-marks', { 'aria-hidden': 'true' });
  ctx.frame.appendChild(marks);
  // Before and after, over every tool but Crop: the line is the control. Drag it, or Tab to it and use the arrow keys.
  const split = moEl('div', 'mo-pc-ba mo-hidden');
  const tagBefore = moEl('span', 'mo-pc-ba-tag', { textContent: 'Before', 'aria-hidden': 'true' });
  const tagAfter = moEl('span', 'mo-pc-ba-tag', { 'aria-hidden': 'true' });
  const splitLine = moEl('div', 'mo-pc-ba-line');
  splitLine.appendChild(moEl('span', 'mo-pc-ba-knob', { 'aria-hidden': 'true' }));
  split.append(tagBefore, tagAfter, splitLine);
  ctx.frame.appendChild(split);
  disposers.push(moSliderKeys(splitLine, 'Before and after line', { min: 0, max: 1, step: 0.02, big: 0.1, get: () => Math.max(0, state.split), set: (v) => ctx.setSplit(v), text: (v) => `${Math.round(v * 100)}% shows the photo` }));
  const splitDrag = api.ui.onDragPress(splitLine, (e) => {
    e.preventDefault();
    splitLine.focus({ preventScroll: true });
    const move = (ev) => { const r = ctx.frame.getBoundingClientRect(), u = (ev.clientX - r.left) / Math.max(1, r.width); ctx.setSplit(Math.max(0, Math.min(1, state.mirror ? 1 - u : u))); };
    const up = () => { splitLine.removeEventListener('pointermove', move); splitLine.removeEventListener('pointerup', up); splitLine.removeEventListener('pointercancel', up); };
    try { splitLine.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
    splitLine.addEventListener('pointermove', move); splitLine.addEventListener('pointerup', up); splitLine.addEventListener('pointercancel', up);
  }, { pointerEvents: true });
  disposers.push(() => splitDrag.dispose());
  disposers.push(moPointKeys(layer, 'Picture. Arrow keys move the picker, Enter saves the colour under it.', {
    move: (dx, dy) => { const p = point || { u: 0.5, v: 0.5 }; setPoint(Math.max(0, Math.min(1, p.u + dx / 100)), Math.max(0, Math.min(1, p.v + dy / 100)), false); },
    take: () => { if (!point) setPoint(0.5, 0.5, false); save(); },
  }));
  const onFocus = () => { if (!point) setPoint(0.5, 0.5, false); };
  const onBlur = () => { if (!pressing) hideLoupe(); };
  layer.addEventListener('focus', onFocus); layer.addEventListener('blur', onBlur);

  const ui = api.ui;

  // ── stages ──
  const currentStage = () => { const n = Number(state.recipe && state.recipe.stage) || 0; return n >= 1 && n <= shared.stages.length ? n : 0; };
  function applyStage(n) {
    const r = state.recipe;
    if (!r) return;
    if (n >= 1 && n <= shared.stages.length) {
      const s = shared.stages[n - 1];
      Object.assign(r, { stage: n, blur: s.blur, levels: s.levels, grey: s.grey, notan: s.notan });
    } else if (n === 0) Object.assign(r, { stage: 0, blur: 0, levels: 0, grey: false, notan: 0 });
    else return;
    ctx.afterRecipeChange(true);
    live.textContent = n ? `Stage ${n}, ${shared.stages[n - 1].name}` : 'The picture as it is';
  }
  // A change to squint or values: kept in the recipe, and in the stage when one is chosen.
  function setAid(patch, record, keep) {
    const r = state.recipe;
    Object.assign(r, patch);
    const n = currentStage();
    if (n) { Object.assign(shared.stages[n - 1], patch); if (record) void saveStages(io); }
    if (record) ctx.afterRecipeChange(true, keep); else ctx.preview();
    if (keep && n) {
      const b = ctx.root.querySelector(`.mo-pc-stages .mo-pc-stage:nth-child(${n})`);
      if (b) { b.querySelector('.mo-pc-stage-sum').textContent = stageSummary(shared.stages[n - 1]); b.setAttribute('aria-label', `${shared.stages[n - 1].name}, ${stageSummary(shared.stages[n - 1])}`); }
    }
  }
  // ── the Values step ──
  // Squint and the number of values are sliders; light and shadow is two values only, split where light
  // ends. The values are laid in one paint (the underpainting colour) or in grey. Stages keep a squint and
  // values to come back to, for every plan (keys 1 to 9).
  const toNotan = (v) => (10 * v + 16) / 116;            // a value (0 to 10) as the engine's lightness
  const fromNotan = (n) => Math.round(((116 * n - 16) / 10) * 2) / 2;
  function valuesPanel(panel, panelDisposers) {
    const r = state.recipe;
    const n = currentStage();
    const s1 = moPlanSection(panel, '');
    moPlanSlider(s1, { id: 'media-organizer.plan.squint', label: 'Squint', min: 0, max: 100, step: 1, value: moSquintPos((r.blur || 0) * 100), text: (v) => moSquintText(moSquintAt(v)),
      onInput: (v) => setAid({ blur: moSquintAt(v) / 100 }, false), onChange: (v) => setAid({ blur: moSquintAt(v) / 100 }, true, true) });
    const light = r.notan > 0;
    if (!light) moPlanSlider(s1, { id: 'media-organizer.plan.values', label: 'Values', min: 2, max: 11, step: 1, value: r.levels >= 2 ? r.levels : 11, text: (v) => (v >= 11 ? 'all' : String(v)),
      onInput: (v) => setAid({ levels: v >= 11 ? 0 : v, notan: 0 }, false), onChange: (v) => setAid({ levels: v >= 11 ? 0 : v, notan: 0 }, true, true) });
    const split = light ? fromNotan(r.notan) : (ctx.lightSplit() ?? 5);
    moPlanSwitch(ui, s1, { id: 'media-organizer.plan.lightShadow', label: 'Light and shadow only', checked: light, onChange: (on) => setAid(on ? { notan: toNotan(split), levels: 0 } : { notan: 0 }, true) }, panelDisposers);
    if (light) moPlanSlider(s1, { id: 'media-organizer.plan.lightEnds', label: 'Where light ends', min: 1, max: 9, step: 0.5, value: split, text: (v) => `value ${v}`,
      onInput: (v) => setAid({ notan: toNotan(v) }, false), onChange: (v) => setAid({ notan: toNotan(v) }, true, true) });

    const s2 = moPlanSection(panel, 'Underpainting colour', true);
    const chips = moEl('div', 'mo-pv-unders', { role: 'group', 'aria-label': 'Underpainting colour' });
    for (const name of MO_PLAN_UNDERS) {
      const p = MO_COMMON_PAINTS.find((x) => x.name === name);
      const b = ui.createButton(chips, { id: `media-organizer.plan.under.${moSlug(name || 'grey')}`, label: name || 'Grey', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.underPaint', args: [name] });
      b.classList.add('mo-pv-under'); b.setAttribute('aria-pressed', String((r.under || '') === name));
      const dot = moEl('span', 'mo-pv-under-dot', { 'aria-hidden': 'true' });
      if (p) dot.style.background = p.hex;
      b.prepend(dot);
    }
    s2.appendChild(chips);
    moPlanHint(s2, 'The values in one paint, from its darks to its tints, the way a monochrome underpainting is laid in. Colour amount in the Colour step fades to it too.');

    const fam = ctx.lightFamilies(light ? split : null);
    if (fam) {
      const s3 = moPlanSection(panel, 'Light and shadow', true);
      for (const [i, word] of [[0, 'Light'], [1, 'Shadow']]) {
        const row = moEl('div', 'mo-ps-row');
        const sw = moEl('span', 'mo-ps-sw', { 'aria-hidden': 'true' }); sw.style.background = hexOf(fam.families[i].rgb);
        row.append(sw, moEl('span', 'mo-ps-row-text', { textContent: `${word} · ${moColourName(fam.families[i].rgb).name}` }), moEl('span', 'mo-ps-num', { textContent: `${Math.round(fam.families[i].share * 100)}%` }));
        s3.appendChild(row);
      }
      moPlanHint(s3, fam.warmer === 'neither' ? 'Both families are about the same temperature.' : `The ${fam.warmer} family is warmer. A shadow is rarely the light colour made darker.`);
    }

    const s4 = moPlanSection(panel, 'Stages', true);
    const list = moEl('div', 'mo-pv-stages', { role: 'group', 'aria-label': 'Stages' });
    shared.stages.forEach((st, i) => {
      const b = ui.createButton(list, { id: `media-organizer.plan.stage.${i + 1}`, label: st.name, kind: 'ghost', size: 'sm', title: `${st.name}: ${stageSummary(st)} (key ${i + 1})`, command: `media-organizer.plan.stage${i + 1}` });
      b.classList.add('mo-pv-stage'); b.setAttribute('aria-pressed', String(n === i + 1)); b.setAttribute('aria-keyshortcuts', String(i + 1));
    });
    const more = ui.createIconButton(list, { id: 'media-organizer.plan.stageMenu', icon: 'ellipsis', title: 'Stage Actions', size: 'sm', command: 'media-organizer.plan.stageMenu' });
    more.setAttribute('aria-haspopup', 'menu');
    s4.appendChild(list);
    moPlanHint(s4, n ? `Changes are saved to ${shared.stages[n - 1].name} for every plan. Keys 1 to ${shared.stages.length} switch stages.` : `A stage keeps a squint and values to come back to. Keys 1 to ${shared.stages.length} switch stages.`);
  }

  // ── the picker ──
  function cropOf() { return state.recipe.crop; }
  function sampleKey() {
    const r = state.recipe;
    return JSON.stringify(r, (k, v) => (k === 'saved' || k === 'stage' || k === 'palette' || k === 'overlays' || k === 'blur' || k === 'levels' || k === 'grey' || k === 'notan' ? undefined : v));
  }
  function sample(u, v) {
    const key = sampleKey();
    if (!cache || cache.key !== key) { const got = ctx.editedPixels(1024); if (!got) return null; cache = Object.assign(got, { key }); }
    const { px, w, h } = cache;
    const cssW = ctx.frame.clientWidth || w;
    const half = Math.max(0, ((shared.pickSize * w) / cssW - 1) / 2);
    const cx = u * w, cy = v * h;
    const x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(w - 1, Math.floor(cx + half));
    const y0 = Math.max(0, Math.floor(cy - half)), y1 = Math.min(h - 1, Math.floor(cy + half));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    return n ? [r / n, g / n, b / n].map(Math.round) : null;
  }
  function setPoint(u, v, touch) {
    point = { u, v };
    const rgb = sample(u, v);
    point.rgb = rgb;
    const W = ctx.frame.clientWidth, H = ctx.frame.clientHeight;
    const lift = touch ? 64 : 0; // above a finger, so the finger does not cover it
    loupe.classList.remove('mo-hidden');
    loupe.style.left = `${u * W}px`; loupe.style.top = `${v * H - lift}px`;
    const box = Math.max(4, Math.min(64, shared.pickSize));
    loupeBox.style.width = loupeBox.style.height = `${box}px`;
    if (rgb) {
      const name = moColourName(rgb);
      loupe.style.background = hexOf(rgb);
      loupeTag.classList.remove('mo-hidden');
      loupeTag.textContent = `${name.name} · ${hexOf(rgb)}`;
      const right = u > 0.6;
      loupeTag.style.left = `${u * W + (right ? -56 : 56)}px`; loupeTag.style.top = `${v * H - lift}px`;
      loupeTag.style.transform = `translate(${right ? '-100%' : '0'}, -50%)${state.mirror ? ' scaleX(-1)' : ''}`; // a mirrored picture keeps the label readable
      showReadout(rgb);
    }
  }
  function hideLoupe() { loupe.classList.add('mo-hidden'); loupeTag.classList.add('mo-hidden'); }
  function frameUV(e) {
    const rect = ctx.frame.getBoundingClientRect();
    let u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    if (state.mirror) u = 1 - u;
    return { u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, v)) };
  }
  let picking = false;          // Colour's eyedropper is on
  const pickOn = () => picking && state.tool === 'colour' && !!state.recipe;
  const onMove = (e) => { if (!pickOn()) return; if (e.pointerType === 'mouse' || pressing) { const p = frameUV(e); setPoint(p.u, p.v, e.pointerType !== 'mouse'); } };
  const onDown = (e) => { if (!pickOn() || (e.pointerType === 'mouse' && e.button !== 0)) return; e.preventDefault(); pressing = true; try { layer.setPointerCapture(e.pointerId); } catch { /* gone */ } layer.focus({ preventScroll: true }); const p = frameUV(e); setPoint(p.u, p.v, e.pointerType !== 'mouse'); };
  const onUp = (e) => { if (!pressing) return; pressing = false; const p = frameUV(e); setPoint(p.u, p.v, e.pointerType !== 'mouse'); save(); if (e.pointerType !== 'mouse') hideLoupe(); };
  const onCancel = () => { pressing = false; hideLoupe(); };
  const onLeave = (e) => { if (!pressing && e.pointerType === 'mouse' && document.activeElement !== layer) hideLoupe(); };
  layer.addEventListener('pointermove', onMove); layer.addEventListener('pointerdown', onDown); layer.addEventListener('pointerup', onUp);
  layer.addEventListener('pointercancel', onCancel); layer.addEventListener('pointerleave', onLeave);

  function save() {
    if (!point || !point.rgb || !state.recipe) return;
    const c = cropOf();
    state.recipe.saved = (state.recipe.saved || []).concat([{ rgb: point.rgb, x: c.x + point.u * c.w, y: c.y + point.v * c.h }]).slice(-64);
    live.textContent = `Saved ${moColourName(point.rgb).name}, ${hexOf(point.rgb)}`;
    ctx.afterRecipeChange(true);
  }
  function showReadout(rgb) {
    if (!readout || !readout.isConnected) return;
    const n = moColourName(rgb);
    readout.querySelector('.mo-pc-chip-lg').style.background = hexOf(rgb);
    readout.querySelector('.mo-pc-name').textContent = n.name;
    readout.querySelector('.mo-pc-sub').textContent = `${cap(n.valueWord)} · value ${n.value} of 10`;
    readout.querySelector('.mo-pc-hex').textContent = hexOf(rgb);
  }

  // ── My Paints, opened from the Colour step ──
  function pickPanel(panel, panelDisposers) { if (view === 'paints') paintsPanel(panel, panelDisposers); }
  function paintsPanel(panel, panelDisposers) {
    readout = null;
    focusIfPending('back', ui.createButton(panel, { id: 'media-organizer.plan.backFromPaints', label: 'Back To Colours', icon: 'chevron-left', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.backFromPaints' }));
    const s1 = moEl('div', 'mo-plan-section');
    const head = moEl('div', 'mo-pc-head');
    head.append(moEl('div', 'mo-practice-section-title', { textContent: 'Paints you have' }), moEl('span', 'mo-practice-dim', { textContent: String(shared.paints.length) }));
    s1.appendChild(head);
    if (!shared.paintsSet) s1.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'Starter paints until you set your own. Paints are kept for every plan.' }));
    const list = moEl('div', 'mo-pc-paints');
    shared.paints.forEach((p, i) => {
      const r = moEl('div', 'mo-pc-paint');
      const dot = moEl('span', 'mo-pc-dot', { 'aria-hidden': 'true' }); dot.style.background = p.hex;
      const x = ui.createIconButton(null, { id: `media-organizer.plan.removePaint.${moSlug(p.name)}`, icon: 'x', title: `Remove ${p.name}`, size: 'sm', command: 'media-organizer.plan.removePaint', args: [p.name] });
      r.append(dot, moEl('span', null, { textContent: p.name }), x);
      list.appendChild(r);
    });
    s1.appendChild(list);
    const have = new Set(shared.paints.map((p) => p.name));
    const addable = MO_COMMON_PAINTS.filter((p) => !have.has(p.name));
    if (addable.length) {
      const dd = ctx.moDropdown({ items: [{ value: '', label: 'Add A Common Paint' }, ...addable.map((p) => ({ value: p.name, label: p.name }))], selected: '', ariaLabel: 'Add A Common Paint' });
      dd.onChange = (v) => { const p = MO_COMMON_PAINTS.find((x) => x.name === v); if (!p) return; shared.paints.push({ ...p }); changed(); };
      panelDisposers.push(() => dd.dispose());
      s1.appendChild(dd.el);
    }
    const row = moEl('div', 'mo-plan-row');
    row.append(button('Custom Paint…', 'customPaint'), button('Use Starter Paints', 'starterPaints'));
    s1.appendChild(row);
    panel.appendChild(s1);

    const R = shared.rules;
    const s2 = moEl('div', 'mo-plan-section mo-pc-split');
    s2.appendChild(moEl('div', 'mo-practice-section-title', { textContent: 'Mixing rules' }));
    s2.appendChild(segField('Most paints in one mix', [2, 3, 4, 5].map((v) => [String(v), String(v)]), String(R.max), (v) => { R.max = Number(v); changed(true); }, 'maxPaints', panelDisposers));
    s2.appendChild(segField('Lighten with', [['white', 'White'], ['water', 'Water']], R.lighten, (v) => { R.lighten = v; changed(true); whiteRule.querySelector('input').disabled = v === 'water'; whiteRule.classList.toggle('is-off', v === 'water'); }, 'lighten', panelDisposers));
    const whiteRule = check('White does not count toward the limit', 'media-organizer.plan.whiteFree', R.whiteFree, (v) => { R.whiteFree = v; changed(true); });
    whiteRule.querySelector('input').disabled = R.lighten === 'water'; whiteRule.classList.toggle('is-off', R.lighten === 'water');
    s2.appendChild(whiteRule);
    s2.appendChild(check('Never use black', 'media-organizer.plan.noBlack', R.noBlack, (v) => { R.noBlack = v; changed(true); }));
    s2.appendChild(check('Prefer fewer paints', 'media-organizer.plan.preferFewer', R.preferFewer, (v) => { R.preferFewer = v; changed(true); }));
    s2.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'With fewer paints preferred, a simpler mix that is nearly as close comes first. Water is for watercolour, where the paper lightens.' }));
    panel.appendChild(s2);
  }

  // ── small parts ──
  // The view just opened takes the focus where the keyboard expects it.
  function focusIfPending(kind, el) {
    if (kind === 'back') el.classList.add('mo-pc-back');
    if (pendingFocus === kind) { pendingFocus = null; queueMicrotask(() => queueMicrotask(() => el.focus())); }
    return el;
  }
  function button(label, action) { return ui.createButton(null, { id: `media-organizer.plan.${action}`, label, kind: 'secondary', size: 'sm', command: `media-organizer.plan.${action}` }); }
  const changed = (keep) => { lastMix = null; void savePaints(io); ctx.afterRecipeChange(false, keep === true); };
  // What each command does on this plan (PLAN_ACTIONS). Panels follow the state.
  const show = (v) => { view = v; pendingFocus = v === 'paints' ? 'back' : null; if (state.tool !== 'colour') ctx.setTool('colour'); else ctx.afterRecipeChange(false); };
  const acts = {
    async renameStage() {
      const n = currentStage(); if (!n) return;
      const name = await api.window.showInputBox({ prompt: 'Name this stage', value: shared.stages[n - 1].name });
      if (!name || !String(name).trim()) return;
      shared.stages[n - 1].name = String(name).trim().slice(0, 40);
      void saveStages(io); ctx.afterRecipeChange(false);
    },
    addStage() {
      if (!state.recipe || shared.stages.length >= MAX_STAGES) return;
      const n = currentStage(), from = n ? shared.stages[n - 1] : state.recipe;
      shared.stages.push({ name: `Stage ${shared.stages.length + 1}`, blur: from.blur || 0, levels: from.levels || 0, grey: !!from.grey, notan: from.notan || 0 });
      void saveStages(io);
      applyStage(shared.stages.length);
    },
    removeStage() {
      const n = currentStage(); if (!n || shared.stages.length < 2) return;
      shared.stages.splice(n - 1, 1);
      void saveStages(io);
      state.recipe.stage = 0; // the picture keeps the look it has
      ctx.afterRecipeChange(true);
    },
    underPaint(name) { if (!state.recipe || !MO_PLAN_UNDERS.includes(name)) return; state.recipe.under = name; ctx.afterRecipeChange(true); },
    stageMenu() {
      const n = currentStage(), at = ctx.root.querySelector('[data-px-id="media-organizer.plan.stageMenu"]');
      if (!at) return;
      ui.createMenu(at, { id: 'media-organizer.plan.stageActions', label: 'Stage Actions', items: [
        { label: n ? 'Add Stage' : 'Save As Stage', disabled: shared.stages.length >= MAX_STAGES, onSelect: () => acts.addStage() },
        { label: 'Rename Stage…', disabled: !n, onSelect: () => void acts.renameStage() },
        { label: 'Remove Stage', disabled: !n || shared.stages.length < 2, onSelect: () => acts.removeStage() },
      ] });
    },
    myPaints() { show('paints'); },
    backFromPaints() { show('list'); },
    async customPaint() {
      const name = await api.window.showInputBox({ prompt: 'Name the paint', placeHolder: 'Paint name' });
      if (!name || !String(name).trim()) return;
      const hex = await api.window.showInputBox({ prompt: `The colour of ${String(name).trim()}, as a hex code`, placeHolder: 'A hex code, like 8A3F22' });
      const rgb = moHexRgb(hex);
      if (!rgb) { if (hex) api.window.showWarningMessage('That is not a hex colour, like 8A3F22.'); return; }
      shared.paints.push({ name: String(name).trim().slice(0, 40), hex: hexOf(rgb) });
      changed();
    },
    starterPaints() { shared.paints = MO_STARTER_PAINTS.map((p) => ({ ...p })); changed(); },
    removePaint(name) { const i = shared.paints.findIndex((p) => p.name === name); if (i >= 0) { shared.paints.splice(i, 1); changed(); } },
  };
  function check(label, sceneId, on, set) {
    const wrap = moEl('label', 'mo-practice-check');
    const input = moEl('input', 'mo-clip-check', { sceneId, type: 'checkbox', 'aria-label': label });
    input.checked = !!on;
    input.addEventListener('change', () => set(input.checked));
    wrap.append(input, moEl('span', null, { textContent: label }));
    return wrap;
  }
  function segField(label, options, value, set, id, panelDisposers) {
    const f = moEl('div', 'mo-pc-field');
    f.appendChild(moEl('span', null, { textContent: label }));
    const g = ui.createSegmented(f, { id: `media-organizer.plan.${id}`, ariaLabel: label, value, items: options.map(([v, text]) => ({ value: v, label: text })), onChange: set });
    panelDisposers.push(() => g.dispose());
    return f;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);


  // After each draw: the stage bar, the picker's layer and the pins.
  function drawMarks() {
    marks.replaceChildren();
    const r = state.recipe;
    if (!r || !state.plan) return;
    const add = (cls, text, css) => { const m = moEl('span', cls, { textContent: text }); Object.assign(m.style, css); marks.appendChild(m); };
    if (state.tool === 'transfer' && r.overlays.gridLabels !== false) {
      const step = r.overlays.gridInches > 0 ? r.overlays.gridInches : 1, g = ctx.gridLines(state.plan.canvas_w, state.plan.canvas_h, step);
      for (let i = 0; i < g.cols; i++) add('mo-pc-gl mo-pc-gl--col', String(i + 1), { left: `${Math.min(100, ((i + 0.5) * step * 100) / state.plan.canvas_w)}%` });
      for (let j = 0; j < g.rows; j++) add('mo-pc-gl mo-pc-gl--row', String.fromCharCode(65 + (j % 26)), { top: `${Math.min(100, ((j + 0.5) * step * 100) / state.plan.canvas_h)}%` });
    }
    const splitOn = state.split >= 0 && state.tool !== 'compose';
    split.classList.toggle('mo-hidden', !splitOn);
    if (splitOn) {
      splitLine.style.left = tagAfter.style.left = `${state.split * 100}%`;
      tagBefore.style.right = `${(1 - state.split) * 100}%`;
      tagAfter.textContent = ctx.sameBothSides() ? 'After, no edits yet' : 'After';
      splitLine.setAttribute('aria-valuenow', String(Math.round(state.split * 1000) / 1000));
    }
  }
  function sync() {
    drawMarks();
    const on = pickOn();
    layer.classList.toggle('mo-hidden', !on);
    if (!on) { hideLoupe(); pins.replaceChildren(); return; }
    if (layer.tabIndex !== 0) layer.tabIndex = 0;
    pins.replaceChildren();
    if (shared.pins) {
      const c = cropOf();
      for (const s of state.recipe.saved || []) {
        if (s.x == null || s.y == null) continue;
        const u = (s.x - c.x) / c.w, v = (s.y - c.y) / c.h;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const pin = moEl('span', 'mo-pc-pin');
        pin.style.left = `${u * 100}%`; pin.style.top = `${v * 100}%`; pin.style.background = hexOf(s.rgb);
        pins.appendChild(pin);
      }
    }
    if (point && !loupe.classList.contains('mo-hidden')) setPoint(point.u, point.v, false);
  }

  const handle = { root: ctx.root, stage: (n) => applyStage(n), act: (name, ...args) => acts[name] && acts[name](...args) };
  lastUsed = handle;
  open.add(handle);
  const onFocusIn = () => { lastUsed = handle; if (shared.focusKey) shared.focusKey.set(true); };
  const onFocusOut = (e) => { if (shared.focusKey && !ctx.root.contains(e.relatedTarget)) shared.focusKey.set(false); };
  ctx.root.addEventListener('focusin', onFocusIn); ctx.root.addEventListener('focusout', onFocusOut);
  void loadShared(io).then(() => { if (state.recipe) ctx.afterRecipeChange(false); });

  return {
    valuesPanel,
    pickPanel,
    inPaints: () => view === 'paints',
    picker: { on: () => picking, set: (v) => { picking = !!v; if (!picking) hideLoupe(); }, size: () => shared.pickSize, setSize: (v) => { shared.pickSize = Math.max(1, Math.min(45, Math.round(v))); void savePick(io); if (point) setPoint(point.u, point.v, false); } },
    sync,
    // A new variation or an undo: the colour shown may be gone.
    reset() { cache = null; },
    dispose() {
      open.delete(handle);
      if (lastUsed === handle) lastUsed = null;
      if (shared.focusKey && ctx.root.contains(document.activeElement)) shared.focusKey.set(false);
      ctx.root.removeEventListener('focusin', onFocusIn); ctx.root.removeEventListener('focusout', onFocusOut);
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
      layer.remove();
    },
  };
}
