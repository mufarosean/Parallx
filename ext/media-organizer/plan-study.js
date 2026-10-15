// plan-study.js — the plan's Study tool (the Colour Study): lenses over the
// edited picture, each showing one relationship a painter has to see (light
// and shadow, temperature, colour masses, intensity), two spots compared in
// a painter's words with how to mix each from the painter's own paints, and
// a palette made from the colour masses. The arithmetic is study-math.js.
//
// The lens settings live in the recipe (`study`), so each variation keeps its
// own. The picture is analysed at a working size once per edit; a setting
// only redraws the lens. With Before And After on, the lens covers the after
// side and the photo shows on the before side.

import { moEl } from './dom.js';
import { moPointKeys } from './keys.js';
import { moColourName, moMixRecipes } from './colour.js';
import { moPlanPaintSet } from './plan-colours.js';
import { moStudyAnalyse, moStudyCompare, moStudyIntensityLens, moStudyLight, moStudyMassNames, moStudyMasses, moStudyNormalize, moStudySpot, moStudyTemperature } from './study-math.js';

const WORK = 560;   // the long side the picture is analysed at
const LENSES = [
  ['picture', 'Picture', 'image', 'The picture as it is'],
  ['light', 'Light And Shadow', 'sun-moon', 'Two families, and the colour of each'],
  ['temp', 'Temperature', 'thermometer', 'Warmer and cooler than what is around'],
  ['masses', 'Colour Masses', 'shapes', 'Big shapes of one colour each'],
  ['intensity', 'Intensity', 'droplet', 'Where the strong colour is'],
];
const LOOK = {
  picture: 'Click two spots on the picture to compare them.',
  light: 'Do the lights lean warm and the shadows cool? A shadow is rarely the light colour made darker.',
  temp: 'Orange is warmer than what surrounds it, blue is cooler. Light and shadow often differ in temperature too.',
  masses: 'Each mass is one colour to mix and lay in with a big brush. Start with three or four.',
  intensity: 'Strong colour is spent, not spread: keep it where it matters.',
};
const ACTIONS = ['studyLens', 'studyMass', 'studyPalette', 'studyClearSpots'];
const hexOf = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const pct = (v) => `${Math.round(v * 100)}%`;

const open = new Set();
let lastUsed = null;
const inUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanStudyActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = inUse(); return p ? p.act(a, ...args) : undefined; }));
}

/**
 * ctx: { api, state, root, frame, editedPixels(maxSide) -> { px, w, h } | null,
 *   afterRecipeChange(record, keepPanel), setTool(id), getSetting, setSetting }.
 * The editor calls panel() for the Study tool and sync() after every draw.
 */
export function moPlanStudy(ctx) {
  const { api, state } = ctx;
  const ui = api.ui;
  const io = { getSetting: ctx.getSetting, setSetting: ctx.setSetting };
  let P = null; let pKey = '';         // the analysed picture, and the edit it was made from
  let shown = null; let shownKey = ''; // the lens drawn, and the settings it was drawn with
  let sel = -1;                        // the mass shown alone
  let spots = [];                      // [{ u, v }] on the picture, 0..1
  let cursor = null;                   // the keyboard's spot
  let readout = null;                  // the panel's readout, rebuilt in place
  let paints = null;
  void moPlanPaintSet(io).then((p) => { paints = p; refreshReadout(); }).catch(() => {});

  // ── on the picture: the lens, the spots, and the layer that takes clicks and keys ──
  const canvas = moEl('canvas', 'mo-ps-lens mo-hidden', { 'aria-hidden': 'true' });
  const marks = moEl('div', 'mo-ps-marks', { 'aria-hidden': 'true' });
  const layer = moEl('div', 'mo-pc-layer mo-ps-layer mo-hidden');
  ctx.frame.append(canvas, marks, layer);
  const disposers = [];
  disposers.push(moPointKeys(layer, 'Picture. Arrow keys move a spot, Enter compares it.', {
    move: (dx, dy) => { cursor = cursor || { u: 0.5, v: 0.5 }; cursor = { u: Math.max(0, Math.min(1, cursor.u + dx * 0.01)), v: Math.max(0, Math.min(1, cursor.v + dy * 0.01)) }; drawMarks(); },
    take: () => { addSpot(cursor || { u: 0.5, v: 0.5 }); },
  }));
  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const r = layer.getBoundingClientRect();
    let u = (e.clientX - r.left) / Math.max(1, r.width);
    if (state.mirror) u = 1 - u;
    addSpot({ u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))) });
  };
  layer.addEventListener('pointerdown', onDown);
  disposers.push(() => layer.removeEventListener('pointerdown', onDown));

  const study = () => moStudyNormalize(state.recipe && state.recipe.study);
  function setStudy(change, record, keepPanel) {
    const s = study();
    state.recipe.study = Object.assign(s, change, change.masses ? { masses: Object.assign(s.masses, change.masses) } : {}, change.temp ? { temp: Object.assign(s.temp, change.temp) } : {});
    ctx.afterRecipeChange(record, keepPanel);
  }
  function addSpot(p) { if (spots.length >= 2) spots = []; spots.push(p); cursor = p; drawMarks(); refreshReadout(); }
  function drawMarks() {
    marks.replaceChildren();
    const put = (p, text, cls) => { const m = moEl('span', `mo-ps-spot${cls ? ` ${cls}` : ''}`, { textContent: text }); m.style.left = pct(p.u); m.style.top = pct(p.v); marks.appendChild(m); };
    spots.forEach((p, j) => put(p, j ? 'B' : 'A'));
    if (cursor && document.activeElement === layer && !spots.includes(cursor)) put(cursor, '', 'mo-ps-spot--cursor');
  }

  // ── the analysis and the lens ──
  function analysed() {
    const r = state.recipe;
    const key = JSON.stringify(Object.assign({}, r, { study: null, saved: null, palette: null, overlays: null, stage: null }));
    if (P && key === pKey) return P;
    const got = ctx.editedPixels(WORK);
    if (!got) return null;
    P = moStudyAnalyse(got.px, got.w, got.h); pKey = key; shownKey = ''; spots = []; sel = -1;
    return P;
  }
  function lens() {
    const A = analysed();
    if (!A) return null;
    const s = study();
    const key = `${pKey}|${JSON.stringify(s)}|${sel}`;
    if (shown && key === shownKey) return shown;
    const split = s.split === null ? A.split : s.split;
    let out = null;
    if (s.lens === 'light') out = Object.assign({ kind: 'light', split }, moStudyLight(A, split, s.light));
    else if (s.lens === 'temp') out = Object.assign({ kind: 'temp' }, moStudyTemperature(A, s.temp.against, s.temp.min));
    else if (s.lens === 'masses') { const m = moStudyMasses(A, s.masses, sel); out = Object.assign({ kind: 'masses', names: moStudyMassNames(m.masses) }, m); }
    else if (s.lens === 'intensity') out = Object.assign({ kind: 'intensity', keep: s.keep }, moStudyIntensityLens(A, s.keep));
    else out = { kind: 'picture' };
    shown = out; shownKey = key;
    if (out.pixels) {
      canvas.width = A.w; canvas.height = A.h;
      canvas.getContext('2d').putImageData(new ImageData(out.pixels, A.w, A.h), 0, 0);
    }
    return out;
  }

  /** After every draw: the lens over the picture while the Study tool is open. */
  function sync() {
    const on = state.tool === 'study' && !!state.recipe;
    layer.classList.toggle('mo-hidden', !on);
    marks.classList.toggle('mo-hidden', !on);
    if (!on) { canvas.classList.add('mo-hidden'); return; }
    if (layer.tabIndex !== 0) layer.tabIndex = 0;
    const before = shownKey;
    const L = lens();
    canvas.classList.toggle('mo-hidden', !L || !L.pixels);
    canvas.style.clipPath = state.split >= 0 ? `inset(0 0 0 ${pct(state.split)})` : '';
    drawMarks();
    if (shownKey !== before) refreshReadout();
  }

  // ── the panel ──
  function slider(label, id, min, max, step, value, text, onSet) {
    const row = moEl('div', 'mo-plan-slider');
    const head = moEl('div', 'mo-plan-slider-head');
    const val = moEl('span', 'mo-practice-dim', { textContent: text(value) });
    head.append(moEl('span', null, { textContent: label }), val);
    const input = moEl('input', null, { sceneId: `media-organizer.plan.study.${id}`, type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label, 'aria-valuetext': text(value) });
    input.value = String(value);
    input.addEventListener('input', () => { const v = Number(input.value); val.textContent = text(v); input.setAttribute('aria-valuetext', text(v)); onSet(v, false); });
    input.addEventListener('change', () => onSet(Number(input.value), true));
    row.append(head, input);
    return row;
  }
  function segmented(parent, label, id, items, value, onSet, disposersOut) {
    const f = moEl('div', 'mo-pc-field');
    f.appendChild(moEl('span', null, { textContent: label }));
    const seg = ui.createSegmented(f, { id: `media-organizer.plan.study.${id}`, ariaLabel: label, value, items: items.map(([v, l]) => ({ value: v, label: l })), onChange: onSet });
    disposersOut.push(() => seg.dispose());
    parent.appendChild(f);
  }
  const section = (parent, title, split) => { const el = moEl('div', `mo-plan-section${split ? ' mo-pc-split' : ''}`); if (title) el.appendChild(moEl('div', 'mo-practice-section-title', { textContent: title })); parent.appendChild(el); return el; };
  function panel(container, panelDisposers) {
    const s = study();
    const s1 = section(container, 'Lens');
    const list = moEl('div', 'mo-ps-lenses', { role: 'group', 'aria-label': 'Lens' });
    for (const [id, label, icon, note] of LENSES) {
      const b = ui.createButton(list, { id: `media-organizer.plan.study.lens.${id}`, label, icon, kind: 'ghost', size: 'sm', command: 'media-organizer.plan.studyLens', args: [id], title: note });
      b.classList.add('mo-ps-lens-btn'); b.setAttribute('aria-pressed', String(s.lens === id));
    }
    s1.appendChild(list);

    const s2 = section(container, '', true);
    if (s.lens === 'light') {
      const A = analysed();
      const split = s.split === null ? (A ? A.split : 5) : s.split;
      s2.appendChild(slider('Where light ends', 'split', 1, 9, 0.5, split, (v) => `value ${v}`, (v, rec) => setStudy({ split: v }, rec, true)));
      segmented(s2, 'Show', 'lightShow', [['colours', 'In Colour'], ['bw', 'Two Tones']], s.light, (v) => setStudy({ light: v }, true, true), panelDisposers);
    } else if (s.lens === 'temp') {
      segmented(s2, 'Compare with', 'tempAgainst', [['near', 'Neighbours'], ['all', 'Whole Picture']], s.temp.against, (v) => setStudy({ temp: { against: v } }, true, true), panelDisposers);
      s2.appendChild(slider('Show differences from', 'tempMin', 0, 100, 5, s.temp.min, (v) => (v < 30 ? 'slight' : v < 65 ? 'clear' : 'strong'), (v, rec) => setStudy({ temp: { min: v } }, rec, true)));
    } else if (s.lens === 'masses') {
      s2.appendChild(slider('Masses', 'massCount', 2, 16, 1, s.masses.n, (v) => String(v), (v, rec) => { sel = -1; setStudy({ masses: { n: v } }, rec, true); }));
      segmented(s2, 'Find masses by', 'massMethod', [['colour', 'Colour'], ['place', 'Place'], ['shapes', 'Squint']], s.masses.method, (v) => { sel = -1; setStudy({ masses: { method: v } }, true, true); }, panelDisposers);
      segmented(s2, 'A mass\u2019s colour', 'massColour', [['dominant', 'Local Colour'], ['average', 'Average']], s.masses.colour, (v) => setStudy({ masses: { colour: v } }, true, true), panelDisposers);
      s2.appendChild(slider('Colour amount', 'massAmount', 0, 100, 5, s.masses.amount, (v) => (v === 0 ? 'grey, value only' : `${v}%`), (v, rec) => setStudy({ masses: { amount: v } }, rec, true)));
    } else if (s.lens === 'intensity') {
      s2.appendChild(slider('Keep colour stronger than', 'keep', 0, 14, 0.5, s.keep, (v) => String(v), (v, rec) => setStudy({ keep: v }, rec, true)));
    }
    s2.appendChild(moEl('div', 'mo-ps-tip', { textContent: LOOK[s.lens] }));

    readout = moEl('div', 'mo-ps-readout', { 'aria-live': 'polite' });
    container.appendChild(readout);
    panelDisposers.push(() => { readout = null; });
    refreshReadout();
  }

  function mixLine(rgb) {
    if (!paints) return '';
    const best = moMixRecipes(rgb, paints.paints, paints.rules).best;
    if (!best) return 'no close mix from your paints';
    const what = best.paints.length === 1 ? `${best.paints[0].name} on its own` : best.paints.map((p) => (p.touch ? `a touch of ${p.name}` : `${p.parts} ${p.name}`)).join(', ');
    return `${what} (${best.closeness.toLowerCase()})`;
  }
  /** A row: swatch, words, and a number at the right. */
  function row(parent, rgb, text, num) {
    const r = moEl('div', 'mo-ps-row');
    const sw = moEl('span', 'mo-ps-sw', { 'aria-hidden': 'true' }); sw.style.background = hexOf(rgb);
    r.append(sw, moEl('span', 'mo-ps-row-text', { textContent: text }), moEl('span', 'mo-ps-num', { textContent: num || '' }));
    parent.appendChild(r);
    return r;
  }
  function refreshReadout() {
    if (!readout || state.tool !== 'study' || !state.recipe) return;
    readout.replaceChildren();
    const note = (parent, t) => parent.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: t }));
    const L = shown;
    if (L && L.kind === 'light') {
      const sec = section(readout, 'Families', true);
      row(sec, L.families[0].rgb, 'Light', pct(L.families[0].share));
      row(sec, L.families[1].rgb, 'Shadow', pct(L.families[1].share));
      note(sec, L.warmer === 'neither' ? 'Both are about the same temperature.' : `The ${L.warmer} family is warmer.`);
    } else if (L && L.kind === 'masses') {
      const sec = section(readout, 'Masses', true);
      const list = moEl('div', 'mo-ps-masses', { role: 'group', 'aria-label': 'Masses: choose one to see it alone' });
      L.masses.forEach((m, k) => {
        const b = ui.createButton(list, { id: `media-organizer.plan.study.mass.${k}`, label: L.names[k], kind: 'ghost', size: 'sm', command: 'media-organizer.plan.studyMass', args: [m.j] });
        b.classList.add('mo-ps-mass'); b.setAttribute('aria-pressed', String(sel === m.j));
        const sw = moEl('span', 'mo-ps-sw', { 'aria-hidden': 'true' }); sw.style.background = hexOf(m.rgb);
        b.prepend(sw);
        b.append(moEl('span', 'mo-ps-mass-detail', { textContent: `Value ${m.value.toFixed(1)} · intensity ${m.intensity.toFixed(1)}` }), moEl('span', 'mo-ps-num', { textContent: pct(m.share) }));
      });
      sec.appendChild(list);
      ui.createButton(sec, { id: 'media-organizer.plan.studyPalette', label: 'Make Palette From Masses', icon: 'palette', size: 'sm', command: 'media-organizer.plan.studyPalette', title: 'The masses become the plan\u2019s colours, each with how to mix it from your paints' }).classList.add('mo-ps-wide');
    } else if (L && L.kind === 'intensity') {
      const sec = section(readout, 'Intensity', true);
      const bars = moEl('div', 'mo-ps-hist', { 'aria-hidden': 'true' });
      const max = Math.max(1, ...L.hist);
      L.hist.forEach((v, j) => { const bar = moEl('span', j >= L.keep ? 'mo-ps-bar is-kept' : 'mo-ps-bar'); bar.style.height = pct(v / max); bars.appendChild(bar); });
      sec.appendChild(bars);
      note(sec, `${pct(L.keptShare)} of the picture is stronger than ${L.keep}.`);
    }
    // Two spots, in any lens.
    const sec = section(readout, 'Compare two spots', true);
    const A = P;
    if (!spots.length || !A) { note(sec, 'Click two spots on the picture.'); return; }
    const at = (p) => moStudySpot(A, p.u * (A.w - 1), p.v * (A.h - 1));
    const a = at(spots[0]);
    row(sec, a.rgb, `A · ${moColourName(a.rgb).name}`, `value ${a.value.toFixed(1)}`);
    if (spots.length === 1) { note(sec, 'Now click B.'); return; }
    const b = at(spots[1]);
    row(sec, b.rgb, `B · ${moColourName(b.rgb).name}`, `value ${b.value.toFixed(1)}`);
    const diff = moEl('ul', 'mo-ps-compare');
    for (const t of moStudyCompare(a, b)) diff.appendChild(moEl('li', null, { textContent: t }));
    sec.appendChild(diff);
    if (paints) { note(sec, `Mix A: ${mixLine(a.rgb)}.`); note(sec, `Mix B: ${mixLine(b.rgb)}.`); }
    ui.createButton(sec, { id: 'media-organizer.plan.studyClearSpots', label: 'Clear Spots', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.studyClearSpots' });
  }

  const acts = {
    studyLens(id) { if (LENSES.some((l) => l[0] === id)) { sel = -1; setStudy({ lens: id }, true, false); } },
    studyMass(j) { sel = sel === j ? -1 : Number(j); ctx.afterRecipeChange(false, true); },
    studyPalette() {
      if (!shown || shown.kind !== 'masses') return;
      state.recipe.palette.swatches = shown.masses.filter((m) => m.share >= 0.005).slice(0, 16).map((m) => m.rgb);
      ctx.afterRecipeChange(true);
      ctx.setTool('pick');
    },
    studyClearSpots() { spots = []; cursor = null; drawMarks(); refreshReadout(); },
  };
  const handle = { root: ctx.root, act: (name, ...args) => (acts[name] ? acts[name](...args) : undefined) };
  open.add(handle);
  const used = () => { lastUsed = handle; };
  ctx.root.addEventListener('focusin', used);

  return {
    panel,
    sync,
    dispose() {
      open.delete(handle); if (lastUsed === handle) lastUsed = null;
      ctx.root.removeEventListener('focusin', used);
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
      canvas.remove(); marks.remove(); layer.remove();
    },
  };
}
