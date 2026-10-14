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
import { moPointKeys } from './keys.js';
import { MO_COMMON_PAINTS, MO_MIX_RULES, MO_STARTER_PAINTS, moColourName, moHexRgb, moMixRecipes } from './colour.js';

const STAGES_KEY = 'plan_stages_v1';
const PAINTS_KEY = 'plan_paints_v1';
const PICK_KEY = 'plan_pick_v1';
export const MO_PLAN_STAGES = [
  { name: 'Block In', blur: 0.6, levels: 3, grey: false, notan: 0 },
  { name: 'Big Shapes', blur: 0.3, levels: 5, grey: false, notan: 0 },
  { name: 'Detail', blur: 0, levels: 0, grey: false, notan: 0 },
];
const PICK_SIZES = [1, 3, 9, 21, 45];
const MAX_STAGES = 9;
const hexOf = (rgb) => '\u0023' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const aidsOff = (r) => !(r.blur > 0) && !(r.levels >= 2) && !r.grey && !(r.notan > 0);
const stageSummary = (s) => [s.blur > 0 ? `Squint ${Math.round(s.blur * 100)}%` : 'No squint', s.notan > 0 ? 'notan' : s.levels >= 2 ? `${s.levels} values` : 'all values', s.grey ? 'grey' : ''].filter(Boolean).join(' · ');
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
      if (pk && PICK_SIZES.includes(pk.size)) shared.pickSize = pk.size;
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
const PLAN_ACTIONS = ['renameStage', 'addStage', 'removeStage', 'showSavedColour', 'showSavedColours', 'pullPalette', 'pinColours', 'myPaints', 'backFromPaints',
  'copyRecipe', 'removeSavedColour', 'customPaint', 'starterPaints', 'removePaint'];
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
  let detail = -1;         // the saved colour shown in 'detail'
  let paintsBack = 'list'; // where Back from My Paints goes
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
  disposers.push(moPointKeys(layer, 'Picture. Arrow keys move the picker, Enter saves the colour under it.', {
    move: (dx, dy) => { const p = point || { u: 0.5, v: 0.5 }; setPoint(Math.max(0, Math.min(1, p.u + dx / 100)), Math.max(0, Math.min(1, p.v + dy / 100)), false); },
    take: () => { if (!point) setPoint(0.5, 0.5, false); save(); },
  }));
  const onFocus = () => { if (!point) setPoint(0.5, 0.5, false); };
  const onBlur = () => { if (!pressing) hideLoupe(); };
  layer.addEventListener('focus', onFocus); layer.addEventListener('blur', onBlur);

  // The stage buttons above the picture.
  const bar = moEl('div', 'mo-pc-stagebar');
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
  // Rebuilt only when the stages change, so a focused choice keeps the focus. No choice is
  // shown while the picture has squint or values of its own.
  let barKey = ''; let barSeg = null; let syncing = false;
  function renderBar() {
    if (!state.recipe) return;
    const n = currentStage();
    const value = n ? String(n) : aidsOff(state.recipe) ? '0' : '';
    const key = JSON.stringify(shared.stages.map((st) => st.name));
    if (key !== barKey || !barSeg) {
      barKey = key;
      if (barSeg) barSeg.dispose();
      barSeg = ui.createSegmented(bar, { id: 'media-organizer.plan.stageBar', ariaLabel: 'Stage', value,
        items: [...shared.stages.map((st, i) => ({ value: String(i + 1), label: `${i + 1} ${st.name}` })), { value: '0', label: 'Picture' }],
        onChange: (v) => { if (!syncing) applyStage(Number(v)); } });
    } else if (barSeg.value !== value) { syncing = true; barSeg.value = value; syncing = false; }
  }

  function valuesPanel(panel, panelDisposers) {
    const r = state.recipe;
    const n = currentStage();
    const s1 = moEl('div', 'mo-plan-section');
    s1.appendChild(moEl('div', 'mo-practice-section-title', { textContent: 'Stages' }));
    const list = moEl('div', 'mo-pc-stages', { role: 'group', 'aria-label': 'Stages' });
    shared.stages.forEach((s, i) => {
      const b = ui.createButton(list, { id: `media-organizer.plan.stage.${i + 1}`, label: s.name, kind: 'ghost', command: `media-organizer.plan.stage${i + 1}` });
      b.classList.add('mo-pc-stage');
      b.classList.toggle('is-on', n === i + 1);
      for (const [k, v] of [['aria-pressed', String(n === i + 1)], ['aria-keyshortcuts', String(i + 1)], ['aria-label', `${s.name}, ${stageSummary(s)}`]]) b.setAttribute(k, v);
      const t = moEl('span', 'mo-pc-stage-text');
      t.append(moEl('span', 'mo-pc-stage-name', { textContent: s.name }), moEl('span', 'mo-pc-stage-sum', { textContent: stageSummary(s) }));
      b.replaceChildren(moEl('span', 'mo-pc-stage-num', { textContent: String(i + 1), 'aria-hidden': 'true' }), t);
    });
    s1.appendChild(list);
    s1.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: `Keys 1 to ${shared.stages.length} switch stages. 0 shows the picture as it is.` }));
    panel.appendChild(s1);

    const s2 = moEl('div', 'mo-plan-section mo-pc-split');
    s2.appendChild(moEl('div', 'mo-practice-section-title', { textContent: n ? `${shared.stages[n - 1].name} settings` : 'This picture' }));
    // Squint: drags preview, the release saves.
    const sq = moEl('div', 'mo-plan-slider');
    const head = moEl('div', 'mo-plan-slider-head');
    const sqVal = moEl('span', 'mo-practice-dim', { textContent: `${Math.round((r.blur || 0) * 100)}%` });
    head.append(moEl('span', null, { textContent: 'Squint' }), sqVal);
    const sqIn = moEl('input', null, { sceneId: 'media-organizer.plan.squint', type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Squint' });
    sqIn.value = String(Math.round((r.blur || 0) * 100));
    sqIn.addEventListener('input', () => { sqVal.textContent = `${sqIn.value}%`; setAid({ blur: Number(sqIn.value) / 100 }, false); });
    sqIn.addEventListener('change', () => setAid({ blur: Number(sqIn.value) / 100 }, true));
    sq.append(head, sqIn);
    s2.appendChild(sq);
    const vl = moEl('div', 'mo-pc-field');
    vl.appendChild(moEl('span', null, { textContent: 'Values' }));
    const vg = ui.createSegmented(vl, { id: 'media-organizer.plan.values', ariaLabel: 'Values', value: r.notan > 0 ? '' : r.levels >= 2 ? String(r.levels) : '0',
      items: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['0', 'All']].map(([value, label]) => ({ value, label })), onChange: (v) => setAid({ levels: Number(v), notan: 0 }, true, !(r.notan > 0)) });
    panelDisposers.push(() => vg.dispose());
    s2.appendChild(vl);
    s2.appendChild(check('Greyscale', 'media-organizer.plan.greyscale', r.grey, (v) => setAid({ grey: v }, true)));
    s2.appendChild(check('Notan (light and dark only)', 'media-organizer.plan.notan', r.notan > 0, (v) => setAid(v ? { notan: 0.5, levels: 0 } : { notan: 0 }, true)));
    if (r.notan > 0) {
      const th = moEl('div', 'mo-plan-slider');
      const thHead = moEl('div', 'mo-plan-slider-head');
      const thVal = moEl('span', 'mo-practice-dim', { textContent: String(Math.round(r.notan * 100)) });
      thHead.append(moEl('span', null, { textContent: 'Threshold' }), thVal);
      const thIn = moEl('input', null, { sceneId: 'media-organizer.plan.notanThreshold', type: 'range', min: '5', max: '95', step: '1', 'aria-label': 'Threshold' });
      thIn.value = String(Math.round(r.notan * 100));
      thIn.addEventListener('input', () => { thVal.textContent = thIn.value; setAid({ notan: Number(thIn.value) / 100 }, false); });
      thIn.addEventListener('change', () => setAid({ notan: Number(thIn.value) / 100 }, true));
      th.append(thHead, thIn);
      s2.appendChild(th);
    }
    s2.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: n ? `Changes here are saved to ${shared.stages[n - 1].name} for every plan.` : 'Set squint and values just for this picture, or choose a stage.' }));
    panel.appendChild(s2);

    const s3 = moEl('div', 'mo-plan-row mo-pc-split');
    if (n) s3.appendChild(button('Rename Stage…', 'renameStage'));
    if (shared.stages.length < MAX_STAGES) s3.appendChild(button(n ? 'Add Stage' : 'Save As Stage', 'addStage'));
    if (n && shared.stages.length > 1) s3.appendChild(button('Remove Stage', 'removeStage'));
    panel.appendChild(s3);
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
  const onMove = (e) => { if (state.tool !== 'pick') return; if (e.pointerType === 'mouse' || pressing) { const p = frameUV(e); setPoint(p.u, p.v, e.pointerType !== 'mouse'); } };
  const onDown = (e) => { if (state.tool !== 'pick' || (e.pointerType === 'mouse' && e.button !== 0)) return; e.preventDefault(); pressing = true; try { layer.setPointerCapture(e.pointerId); } catch { /* gone */ } layer.focus({ preventScroll: true }); const p = frameUV(e); setPoint(p.u, p.v, e.pointerType !== 'mouse'); };
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

  // ── the panel ──
  const colours = () => [...(state.recipe.palette.swatches || []).map((rgb, i) => ({ rgb, pulled: true, at: i })), ...(state.recipe.saved || []).map((c, i) => Object.assign({}, c, { pulled: false, at: i }))];
  function pickPanel(panel, panelDisposers) {
    if (view === 'detail' && colours()[detail]) return detailPanel(panel);
    if (view === 'paints') return paintsPanel(panel, panelDisposers);
    view = 'list';
    const s1 = moEl('div', 'mo-plan-section');
    s1.appendChild(moEl('div', 'mo-practice-section-title', { textContent: 'Under the picker' }));
    readout = moEl('div', 'mo-pc-colour');
    readout.append(moEl('div', 'mo-pc-chip-lg'), textBlock('Point at the picture', '', ''));
    s1.appendChild(readout);
    s1.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'Click the picture to save a colour. From the keyboard: Tab to the picture, arrow keys move the picker, Enter saves.' }));
    panel.appendChild(s1);
    if (point && point.rgb) showReadout(point.rgb);

    const s2 = moEl('div', 'mo-plan-section');
    s2.appendChild(moEl('span', null, { textContent: 'Picker size (px)' }));
    const sg = ui.createSegmented(s2, { id: 'media-organizer.plan.pickSize', ariaLabel: 'Picker size in pixels', value: String(shared.pickSize), items: PICK_SIZES.map((v) => ({ value: String(v), label: String(v) })),
      onChange: (v) => { shared.pickSize = Number(v); void savePick(io); if (point) setPoint(point.u, point.v, false); } });
    panelDisposers.push(() => sg.dispose());
    s2.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'A bigger picker averages more of the picture, the way the eye reads a patch of colour.' }));
    panel.appendChild(s2);

    const s3 = moEl('div', 'mo-plan-section mo-pc-split');
    const list = colours();
    const head = moEl('div', 'mo-pc-head');
    head.append(moEl('div', 'mo-practice-section-title', { textContent: 'Colours of this variation' }), moEl('span', 'mo-practice-dim', { textContent: String(list.length) }));
    s3.appendChild(head);
    if (list.length) {
      const grid = moEl('div', 'mo-pc-chips');
      list.forEach((c, i) => {
        const name = moColourName(c.rgb).name, how = c.pulled ? 'pulled from the picture' : 'picked by hand';
        const b = ui.createButton(grid, { id: `media-organizer.plan.colour.${i}`, label: `${name}, ${hexOf(c.rgb)}, ${how}`, kind: 'ghost', title: `${name} · ${hexOf(c.rgb)} · ${how}`, command: 'media-organizer.plan.showSavedColour', args: [i] });
        b.classList.add('mo-pc-chip');
        if (!c.pulled) b.classList.add('is-picked');
        b.setAttribute('aria-label', `${name}, ${hexOf(c.rgb)}, ${how}`);
        b.replaceChildren();
        b.style.background = hexOf(c.rgb);
        if (i === Math.min(Math.max(detail, 0), list.length - 1)) focusIfPending('chip', b);
      });
      s3.appendChild(grid);
    } else s3.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'No colours yet: pull them from the picture, or click the picture to pick one.' }));
    const pull = moEl('div', 'mo-plan-row');
    pull.appendChild(button('Pull From Picture', 'pullPalette'));
    const cnt = ui.createSegmented(pull, { id: 'media-organizer.plan.colourCount', ariaLabel: 'Colours to pull', value: String(state.recipe.palette.count || 8), items: [4, 6, 8, 12, 16].map((n) => ({ value: String(n), label: String(n) })), onChange: (v) => { state.recipe.palette.count = Number(v) || 8; ctx.afterRecipeChange(false, true); } });
    panelDisposers.push(() => cnt.dispose());
    s3.appendChild(pull);
    s3.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'Pulled and picked colours live together; a blue mark means picked by hand. Every swatch opens its mix.' }));
    s3.appendChild(check('Limited Palette Preview', 'media-organizer.plan.limitedPreview', state.recipe.palette.apply, (v) => { state.recipe.palette.apply = v; ctx.afterRecipeChange(true, true); }));
    s3.appendChild(check('Show Where Colours Came From', 'media-organizer.plan.showPins', shared.pins, (v) => { shared.pins = v; void savePick(io); sync(); }));
    const row = moEl('div', 'mo-plan-row');
    row.append(focusIfPending('chip', button('My Paints…', 'myPaints')), button('Pin Colours To Board', 'pinColours'));
    s3.appendChild(row);
    panel.appendChild(s3);
  }

  function detailPanel(panel) {
    readout = null;
    const c = colours()[detail];
    focusIfPending('back', ui.createButton(panel, { id: 'media-organizer.plan.showSavedColours', label: 'Saved Colours', icon: 'chevron-left', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.showSavedColours' }));
    const n = moColourName(c.rgb);
    const top = moEl('div', 'mo-pc-colour');
    const chip = moEl('div', 'mo-pc-chip-lg mo-pc-chip-xl');
    chip.style.background = hexOf(c.rgb);
    top.append(chip, textBlock(n.name, `${cap(n.valueWord)} · value ${n.value} of 10`, hexOf(c.rgb)));
    panel.appendChild(top);

    const key = JSON.stringify([c.rgb, shared.paints, shared.rules]);
    if (!lastMix || lastMix.key !== key) lastMix = { key, mix: moMixRecipes(c.rgb, shared.paints, shared.rules) };
    const { best, simpler } = lastMix.mix;
    const card = moEl('div', 'mo-plan-section mo-pc-card');
    const ch = moEl('div', 'mo-pc-head');
    ch.append(moEl('div', 'mo-practice-section-title', { textContent: 'Best mix with your paints' }));
    if (best) ch.append(moEl('span', `mo-pc-close mo-pc-close--${best.closeness.toLowerCase().replace(/\s+/g, '-')}`, { textContent: best.closeness }));
    card.appendChild(ch);
    if (!best) card.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'Add the paints you have in My Paints to see how to mix this colour.' }));
    else {
      card.appendChild(mixBar(best, 'mo-pc-bar'));
      for (const p of best.paints) {
        const r = moEl('div', 'mo-pc-paint');
        const dot = moEl('span', 'mo-pc-dot', { 'aria-hidden': 'true' }); dot.style.background = p.hex;
        r.append(dot, moEl('span', null, { textContent: p.name }), moEl('span', 'mo-practice-dim', { textContent: best.paints.length === 1 ? 'on its own' : p.touch ? 'a touch' : `${p.parts} part${p.parts === 1 ? '' : 's'}` }));
        card.appendChild(r);
      }
      const cmp = moEl('div', 'mo-pc-compare');
      for (const [hex, label] of [[hexOf(c.rgb), 'Picked'], [best.hex, 'This mix']]) {
        const col = moEl('div', 'mo-pc-compare-col');
        const sw = moEl('div', 'mo-pc-compare-sw', { 'aria-hidden': 'true' }); sw.style.background = hex;
        col.append(sw, moEl('span', 'mo-practice-dim mo-plan-hint', { textContent: label }));
        cmp.appendChild(col);
      }
      card.appendChild(cmp);
      if (best.closeness === 'Far') card.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'Your paints cannot quite reach this colour. A paint nearer to it would help.' }));
    }
    panel.appendChild(card);
    if (simpler) {
      const s = moEl('div', 'mo-plan-section');
      s.appendChild(moEl('div', 'mo-practice-section-title', { textContent: 'Fewer paints' }));
      const r = moEl('div', 'mo-pc-simpler');
      r.append(mixBar(simpler, 'mo-pc-bar mo-pc-bar--sm'), moEl('span', null, { textContent: recipeText(simpler) }), moEl('span', `mo-pc-close mo-pc-close--${simpler.closeness.toLowerCase().replace(/\s+/g, '-')}`, { textContent: simpler.closeness }));
      s.appendChild(r);
      panel.appendChild(s);
    }
    panel.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: 'An estimate from how pigments mix. Tubes vary by brand: mix a little first and adjust.' }));
    const row = moEl('div', 'mo-plan-row');
    const copy = button('Copy Recipe', 'copyRecipe');
    copy.disabled = !best;
    row.append(copy, button('My Paints…', 'myPaints'), button('Remove', 'removeSavedColour'));
    panel.appendChild(row);
    panel.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: rulesText() + (shared.paintsSet ? '' : ' These are starter paints: set the ones you have in My Paints.') }));
  }

  function paintsPanel(panel, panelDisposers) {
    readout = null;
    focusIfPending('back', ui.createButton(panel, { id: 'media-organizer.plan.backFromPaints', label: paintsBack === 'detail' ? 'Back To Colour' : 'Saved Colours', icon: 'chevron-left', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.backFromPaints' }));
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
  const show = (v) => { view = v; pendingFocus = v === 'list' ? 'chip' : 'back'; if (state.tool !== 'pick') ctx.setTool('pick'); else ctx.afterRecipeChange(false); };
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
    showSavedColour(i) { if (!state.recipe || !colours()[i]) return; detail = i; show('detail'); },
    showSavedColours() { show('list'); },
    pullPalette() { if (state.recipe) ctx.pullPalette(); },
    pinColours() { ctx.addToBoard('This Palette'); },
    myPaints() { paintsBack = view === 'detail' ? 'detail' : 'list'; show('paints'); },
    backFromPaints() { show(paintsBack === 'detail' && colours()[detail] ? 'detail' : 'list'); },
    async copyRecipe() {
      const c = view === 'detail' && colours()[detail]; if (!c) return;
      const best = moMixRecipes(c.rgb, shared.paints, shared.rules).best; if (!best) return;
      try { await navigator.clipboard.writeText(`${moColourName(c.rgb).name} (${hexOf(c.rgb)}): ${recipeText(best)}`); live.textContent = 'Recipe copied'; } catch { /* no clipboard */ }
    },
    removeSavedColour(i) {
      const c = state.recipe && colours()[Number.isInteger(i) ? i : detail];
      if (!c) return;
      if (c.pulled) state.recipe.palette.swatches = state.recipe.palette.swatches.filter((_, k) => k !== c.at);
      else state.recipe.saved = state.recipe.saved.filter((_, k) => k !== c.at);
      view = 'list'; pendingFocus = 'chip'; ctx.afterRecipeChange(true);
    },
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
  function textBlock(name, sub, hex) {
    const t = moEl('div', 'mo-pc-text');
    t.append(moEl('span', 'mo-pc-name', { textContent: name }), moEl('span', 'mo-practice-dim mo-pc-sub', { textContent: sub }), moEl('span', 'mo-practice-dim mo-pc-hex', { textContent: hex }));
    return t;
  }
  function mixBar(rec, cls) {
    const bar = moEl('div', cls, { role: 'img', 'aria-label': recipeText(rec) });
    const top = Math.max(...rec.paints.map((p) => p.parts));
    for (const p of rec.paints) { const s = moEl('span'); s.style.background = p.hex; s.style.flex = String(p.touch ? top * 0.06 : p.parts); bar.appendChild(s); }
    return bar;
  }
  const recipeText = (rec) => (rec.paints.length === 1 ? `${rec.paints[0].name} on its own` : rec.paints.map((p) => (p.touch ? `a touch of ${p.name}` : `${p.parts} part${p.parts === 1 ? '' : 's'} ${p.name}`)).join(', '));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const rulesText = () => {
    const R = shared.rules;
    return `Rules: up to ${R.max} paints${R.lighten === 'water' ? ', lightened with water' : R.whiteFree ? ', white allowed' : ''}${R.noBlack ? ', no black' : ''}.`;
  };

  // After each draw: the stage bar, the picker's layer and the pins.
  function drawMarks() {
    marks.replaceChildren();
    const r = state.recipe;
    if (!r || !state.plan) return;
    const add = (cls, text, css) => { const m = moEl('span', cls, { textContent: text }); Object.assign(m.style, css); marks.appendChild(m); };
    if (r.overlays.grid && state.tool !== 'crop') {
      const step = r.overlays.gridInches > 0 ? r.overlays.gridInches : 1, g = ctx.gridLines(state.plan.canvas_w, state.plan.canvas_h, step);
      for (let i = 0; i < g.cols; i++) add('mo-pc-gl mo-pc-gl--col', String(i + 1), { left: `${Math.min(100, ((i + 0.5) * step * 100) / state.plan.canvas_w)}%` });
      for (let j = 0; j < g.rows; j++) add('mo-pc-gl mo-pc-gl--row', String.fromCharCode(65 + (j % 26)), { top: `${Math.min(100, ((j + 0.5) * step * 100) / state.plan.canvas_h)}%` });
    }
    if (state.tool === 'compare' && state.split >= 0) {
      add('mo-pc-split-line', '', { left: `${state.split * 100}%` });
      add('mo-pc-split-tag mo-pc-split-tag--before', 'Before', { right: `${(1 - state.split) * 100}%` });
      add('mo-pc-split-tag mo-pc-split-tag--after', 'After', { left: `${state.split * 100}%` });
    }
  }
  function sync() {
    renderBar();
    drawMarks();
    const picking = state.tool === 'pick' && !!state.recipe;
    layer.classList.toggle('mo-hidden', !picking);
    if (!picking) { hideLoupe(); pins.replaceChildren(); return; }
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
    bar,
    valuesPanel,
    pickPanel,
    sync,
    // A new variation or an undo: the colour shown may be gone.
    reset() { if (view === 'detail' && !colours()[detail]) view = 'list'; cache = null; },
    dispose() {
      open.delete(handle);
      if (lastUsed === handle) lastUsed = null;
      if (barSeg) barSeg.dispose();
      if (shared.focusKey && ctx.root.contains(document.activeElement)) shared.focusKey.set(false);
      ctx.root.removeEventListener('focusin', onFocusIn); ctx.root.removeEventListener('focusout', onFocusOut);
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
      layer.remove();
    },
  };
}
