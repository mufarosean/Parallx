// colour-study.js — Colour Study, in Atelier's Studio: a sheet for learning to
// mix paint. A colour comes from the painter's wheel, a picture or a plan;
// the sheet shows how to mix it from the paints in use and why each is in the
// mix, lets the mix be changed (parts, a swapped tube) and says what that did,
// and turns one dial at a time (value, intensity, temperature) in rows.
//
// It stands alone: a sheet needs no picture and no plan. Sheets are rows of
// mo_colour_sheets; the paints are the painter's one list (plan-colours.js),
// shared with painting plans. The arithmetic is paint-engine.js; this file
// only draws and listens. Elements stay in place while something is dragged;
// what changes is redrawn once a frame.

import { moEl, moSlug } from './dom.js';
import { moPointKeys, moSliderKeys } from './keys.js';
import { MO_STARTER_PAINTS, moColourName, moHexRgb, moPalette } from './colour.js';
import { moPaintSetRemove, moPaintSetSave, moPaintSetUse, moPaintSets, moPaintsEdit, moPlanPaintSet } from './plan-colours.js';
import { moDrift, moFixMix, moGamut, moHex, moMixOfParts, moRecipe, moSubstitutes, moValue, moVariationRows } from './paint-engine.js';
import { MO_HARMONIES, MO_HARMONY_NAMES, moHslRgb, moRgbHsl, moWheelAngle, moWheelHue } from './paint-wheel.js';
import { moWheelPainter } from './colour-study-wheel.js';
import { MO_COLOUR_ROWS, moRowNote } from './colour-lessons.js';
import { GROUNDS, HOME, VALUE_WORDS, clamp, cleanState, defaultState, groundHex, harmonyColours, parse, rgbOf, say } from './colour-study-state.js';
import { moColourDeps, moColourSheetOpened } from './colour-study-home.js';
import { moDrawBench, moDrawPaints } from './colour-study-panels.js';

// ── a sheet ─────────────────────────────────────────────────────────────────

export function moRenderColourSheet(container, api, sheetId) {
  const deps = moColourDeps(), ui = api.ui, io = { getSetting: deps.getSetting, setSetting: deps.setSetting };
  const root = moEl('div', 'mo-cs');
  container.appendChild(root);
  const disposers = [];
  let disposed = false, st = defaultState(), title = 'Colour Study', picture = '';
  let all = [], rules = {}, setInfo = { sets: [], current: '', starter: true };
  let gamut = null, view = 'rows', fixing = '', whyOpen = '', frame = 0, frameTimer = 0, loaded = false, painted = false, said = '', saveTimer = 0, wheelKey = '', pictureImage = null, pin = null, choosing = false;
  let hsl = []; // each palette colour as hue, saturation, lightness: kept beside the hex so a turn does not drift

  // ── what the page is made of (built once) ──
  const top = moEl('div', 'mo-cs-top');
  const titleEl = moEl('h2', 'mo-cs-title');
  const body = moEl('div', 'mo-cs-body');
  const left = moEl('div', 'mo-cs-left'), right = moEl('div', 'mo-cs-right');
  body.append(left, right);
  root.append(top, body);
  const live = moEl('div', 'mo-cs-live', { 'aria-live': 'polite' });
  root.appendChild(live);
  const idOf = (action, tail) => `media-organizer.colour.${action}${tail != null && tail !== '' ? `.${tail}` : ''}`;
  const go = (parent, action, label, icon, o = {}) => ui.createButton(parent, { id: idOf(action, o.tail), label, icon, kind: o.kind || 'secondary', size: 'sm', command: `media-organizer.colour.${action}`, ...(o.args ? { args: o.args } : {}), ...(o.title ? { title: o.title } : {}) });
  const goIcon = (parent, action, icon, title, o = {}) => ui.createIconButton(parent, { id: idOf(action, o.tail), icon, title, size: 'sm', command: `media-organizer.colour.${action}`, ...(o.args ? { args: o.args } : {}) });
  const pressed = (b, on) => b.setAttribute('aria-pressed', String(!!on));
  const dropdown = (parent, id, label, items, selected, onChange) => {
    const dd = ui.createDropdown(parent, { items, selected, ariaLabel: label });
    if (ui.declareControl) { try { const reg = ui.declareControl(dd.element, { id: `media-organizer.colour.${id}`, label, state: () => ({ kind: 'value', value: dd.value }) }); if (reg && reg.dispose) disposers.push(() => reg.dispose()); } catch { /* not declared */ } }
    if (!dd.element.getAttribute('data-px-id')) dd.element.setAttribute('data-px-id', `media-organizer.colour.${id}`);
    const sub = dd.onDidChange(onChange);
    disposers.push(() => { sub.dispose(); dd.dispose(); });
    return dd;
  };
  const segmented = (parent, id, label, items, value, onChange) => { const s = ui.createSegmented(parent, { id: `media-organizer.colour.${id}`, ariaLabel: label, value, items: items.map(([v, l]) => ({ value: v, label: l })), onChange }); disposers.push(() => s.dispose()); return s; };

  // top bar
  top.appendChild(titleEl);
  top.appendChild(moEl('span', 'mo-cs-grow'));
  const setDd = dropdown(top, 'paintSet', 'Paint set', [{ value: '', label: 'Paints in No Set' }], '', (v) => void useSet(v));
  const paintsBtn = go(top, 'myPaints', 'My Paints', 'palette');
  const greyBtn = go(top, 'valueCheck', 'Value Check', 'contrast', { kind: 'ghost', title: 'Show everything in grey: the squint test' });

  // left: where a colour comes from
  const sourceSeg = segmented(left, 'source', 'Where colours come from', [['wheel', 'Wheel'], ['picture', 'Picture']], 'wheel', (v) => { st.source = v; change(); });
  const wheelBlock = moEl('div', 'mo-cs-block');
  const wheelRow = moEl('div', 'mo-cs-line');
  const wheelSeg = segmented(wheelRow, 'wheelModel', 'Wheel', [['painter', 'Painter'], ['screen', 'Screen']], 'painter', (v) => setWheel(v));
  const harmonyDd = dropdown(wheelRow, 'harmony', 'Harmony', [...Object.keys(MO_HARMONIES).map((k) => ({ value: k, label: MO_HARMONY_NAMES[k] })), { value: 'none', label: 'No Harmony' }], st.harmony, (v) => setHarmony(v));
  const wheelBox = moEl('div', 'mo-cs-wheel', { role: 'group', 'aria-label': 'Colour wheel. Each numbered dot is a palette colour.' });
  const canvas = moEl('canvas', 'mo-cs-wheel-canvas', { 'aria-hidden': 'true' });
  const dotLayer = moEl('div', 'mo-cs-dots');
  wheelBox.append(canvas, dotLayer);
  const painter = moWheelPainter(canvas);
  const wheelCap = moEl('div', 'mo-practice-dim mo-cs-cap');
  const hatchBtn = go(null, 'hatch', 'Hatching', 'eye', { kind: 'ghost', title: 'Hatch what your paints cannot mix' });
  const capRow = moEl('div', 'mo-cs-line');
  capRow.append(wheelCap, hatchBtn);
  wheelBlock.append(wheelRow, wheelBox, capRow);

  const picBlock = moEl('div', 'mo-cs-block');
  const picBox = moEl('div', 'mo-cs-picture-box');
  const picCanvas = moEl('canvas', 'mo-cs-picture');
  const picPin = moEl('span', 'mo-cs-pin mo-hidden', { 'aria-hidden': 'true' });
  picBox.append(picCanvas, picPin);
  const picCap = moEl('div', 'mo-practice-dim mo-cs-cap');
  const picRow = moEl('div', 'mo-cs-line');
  go(picRow, 'choosePlan', 'Choose Plan', 'palette').setAttribute('aria-haspopup', 'menu');
  const choosePicBtn = go(picRow, 'choosePicture', 'Choose Picture', 'image');
  const picker = moEl('section', 'mo-cs-picker mo-hidden', { 'aria-label': 'Choose a picture' });
  const pickSearch = moEl('input', 'mo-clip-input', { type: 'search', 'aria-label': 'Search photos', placeholder: 'Search the library', sceneId: 'media-organizer.colour.pickSearch' });
  picker.id = `mo-cs-picker-${sheetId}`; choosePicBtn.setAttribute('aria-expanded', 'false'); choosePicBtn.setAttribute('aria-controls', picker.id);
  const pickGrid = moEl('div', 'mo-cs-picker-grid', { role: 'group', 'aria-label': 'Photos' });
  picker.append(pickSearch, pickGrid);
  const massTitle = moEl('div', 'mo-practice-section-title', { textContent: 'Colours in this picture' });
  const massList = moEl('div', 'mo-cs-masses', { role: 'group', 'aria-label': 'Colours in this picture' });
  picBlock.append(picBox, picCap, picRow, picker, massTitle, massList);

  const palTitle = moEl('div', 'mo-practice-section-title', { textContent: 'Palette' });
  const palList = moEl('div', 'mo-cs-pal', { role: 'group', 'aria-label': 'Palette' });
  const palHint = moEl('div', 'mo-practice-dim mo-cs-cap');
  left.append(wheelBlock, picBlock, palTitle, palList, palHint);

  // right: the colour, then the rows, the bench or the paints
  const card = moEl('section', 'mo-cs-card', { 'aria-label': 'The colour and how to mix it' });
  const ground = moEl('div', 'mo-cs-ground');
  const targetEl = moEl('span', 'mo-cs-target', { role: 'img' }), mixEl = moEl('span', 'mo-cs-mix', { role: 'img' });
  ground.append(targetEl, mixEl);
  const groundCap = moEl('div', 'mo-cs-ground-cap', { 'aria-hidden': 'true' });
  groundCap.append(moEl('span', null, { textContent: 'Target' }), moEl('span', null, { textContent: 'Your mix' }));
  const groundCol = moEl('div', 'mo-cs-ground-col');
  groundCol.append(ground, groundCap);
  const groundDd = dropdown(groundCol, 'ground', 'The ground the canvas is toned with', GROUNDS.map((g) => ({ value: g, label: g === 'Titanium White' ? 'White Ground' : `${g} Ground`, color: groundHex(g) })), st.ground, (v) => { st.ground = v; change(); });
  const cardWords = moEl('div', 'mo-cs-card-words');
  const nameLine = moEl('div', 'mo-cs-line mo-cs-wrap');
  const nameEl = moEl('div', 'mo-cs-name'), subEl = moEl('div', 'mo-practice-dim mo-cs-sub');
  const bandEl = moEl('span', 'mo-cs-band'), diffEl = moEl('span', 'mo-practice-dim mo-cs-sub');
  nameLine.append(nameEl, subEl, bandEl, diffEl);
  // The recipe: a bar of its parts in the paints' own colours, then the paints. Why each is there shows
  // on a chip's hover, focus or press, so the card stays quiet.
  const partsBar = moEl('div', 'mo-cs-parts-bar', { 'aria-hidden': 'true' });
  const chips = moEl('div', 'mo-cs-chips', { role: 'group', 'aria-label': 'Recipe' });
  const roleLine = moEl('div', 'mo-cs-chip-role mo-practice-dim', { 'aria-live': 'polite' });
  cardWords.append(nameLine, partsBar, chips, roleLine);
  const cardBtns = moEl('div', 'mo-cs-card-acts');
  const editBtn = go(cardBtns, 'editMix', 'Edit Mix', 'pencil');
  goIcon(cardBtns, 'copyRecipe', 'copy', 'Copy Recipe');
  const studyBtn = goIcon(cardBtns, 'studyThis', 'pipette', 'Study This Colour: make the rows from it');
  const putBtn = goIcon(cardBtns, 'putOnPalette', 'swatch-book', 'Put on Palette: replace the chosen palette colour with it');
  card.append(groundCol, cardWords, cardBtns);
  const roles = new Map();
  let roleShown = '';
  /** The role of a paint in the recipe, on the line under the chips ('' clears it). */
  function showRole(name) {
    const role = name && roles.get(name);
    roleLine.textContent = role ? `${name}: ${role.charAt(0).toLowerCase()}${role.slice(1)}` : '';
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c.getAttribute('data-paint') === roleShown));
  }

  const rowsView = moEl('div', 'mo-cs-view'), benchView = moEl('section', 'mo-cs-view mo-cs-bench', { 'aria-label': 'The mix' }), paintsView = moEl('section', 'mo-cs-view mo-cs-paints', { 'aria-label': 'My paints' });
  right.append(card, rowsView, benchView, paintsView);

  // rows: built once, cells restyled in place
  const baseRow = moEl('div', 'mo-cs-line');
  baseRow.appendChild(moEl('span', 'mo-practice-section-title', { textContent: 'Rows from' }));
  const baseDd = dropdown(baseRow, 'base', 'The colour the rows are made from', [{ value: '', label: 'The Chosen Palette Colour' }], '', (v) => setBase(v));
  rowsView.appendChild(baseRow);
  const rowEls = {};
  for (const def of MO_COLOUR_ROWS) {
    const el = moEl('section', 'mo-cs-row', { 'data-row': def.id, 'aria-label': def.title });
    const main = moEl('div', 'mo-cs-row-main');
    const head = moEl('div', 'mo-cs-line');
    head.appendChild(moEl('span', 'mo-practice-section-title', { textContent: def.title }));
    const r = { el, cells: [], nums: null, note: moEl('div', 'mo-cs-row-note'), noteKey: '', whyBtn: null, why: moEl('div', 'mo-cs-why mo-hidden', { role: 'dialog', 'aria-label': `Why: ${def.title}`, id: `mo-cs-why-${sheetId}-${def.id}` }) };
    r.whyBtn = goIcon(head, 'why', 'circle-help', `Why: ${def.title}`, { tail: def.id, args: [def.id] });
    r.whyBtn.setAttribute('aria-controls', r.why.id); r.whyBtn.setAttribute('aria-expanded', 'false'); r.whyBtn.classList.add('mo-cs-why-btn');
    r.why.append(moEl('div', 'mo-cs-why-title', { textContent: `Why: ${def.title}` }), moEl('div', null, { textContent: def.why }));
    head.appendChild(moEl('span', 'mo-cs-grow'));
    if (def.id === 'light') r.lightSeg = segmented(head, 'lightKind', 'The light', [['warm', 'Warm Light'], ['cool', 'Cool Light']], st.light, (v) => { st.light = v; change(); });
    if (def.id === 'twins') r.greyBtn = go(head, 'twinsGrey', 'Show in Grey', 'contrast', { kind: 'ghost' });
    const cells = moEl('div', 'mo-cs-cells', { role: 'toolbar', 'aria-label': `${def.title}. Arrow keys move along the row, Enter shows a colour, Shift Enter studies it.` });
    cells.addEventListener('keydown', (e) => { const at = r.cells.indexOf(document.activeElement), to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? r.cells.length - 1 : -1; if (at < 0 || to < 0 || to >= r.cells.length || e.ctrlKey || e.metaKey || e.altKey) return; e.preventDefault(); r.cells.forEach((c, i) => { c.tabIndex = i === to ? 0 : -1; }); r.cells[to].focus(); });
    for (let i = 0; i < 10; i++) {
      const c = goIcon(null, 'cell', 'pipette', def.title, { tail: `${def.id}.${i + 1}`, args: [def.id, i] });
      c.classList.add('mo-cs-cell'); c.replaceChildren();
      c.addEventListener('dblclick', () => { if (c.dataset.hex) { st.base = c.dataset.hex; st.shown = c.dataset.hex; change(); } });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.shiftKey && c.dataset.hex) { e.preventDefault(); st.base = c.dataset.hex; st.shown = c.dataset.hex; change(); } });
      cells.appendChild(c); r.cells.push(c);
    }
    main.append(head, cells);
    if (def.id === 'value' || def.id === 'light') { r.nums = moEl('div', 'mo-cs-nums', { 'aria-hidden': 'true' }); for (let i = 0; i < 10; i++) r.nums.appendChild(moEl('span')); main.appendChild(r.nums); }
    el.append(main, r.note);
    rowsView.appendChild(el);
    rowEls[def.id] = r;
  }
  const compare = moEl('section', 'mo-cs-compare', { 'aria-label': 'Compare' });
  compare.appendChild(moEl('div', 'mo-practice-section-title', { textContent: 'Compare' }));
  const cmpRow = moEl('div', 'mo-cs-line');
  const cmp = ['Base', 'Shown', 'Base in grey', 'Shown in grey'].map((label, i) => { const s = moEl('span', `mo-cs-cmp${i > 1 ? ' is-grey' : ''}`, { role: 'img', 'aria-label': label, title: label }); cmpRow.appendChild(s); return s; });
  const verdict = moEl('span', 'mo-cs-verdict');
  cmpRow.appendChild(verdict);
  compare.appendChild(cmpRow);
  const tubes = moEl('section', 'mo-cs-tubes', { 'aria-label': 'Limited palette test' });
  tubes.appendChild(moEl('div', 'mo-practice-section-title', { textContent: 'Limited palette test' }));
  const tubeChips = moEl('div', 'mo-cs-line mo-cs-wrap', { role: 'group', 'aria-label': 'Paints in use on this sheet' });
  const tubeNote = moEl('div', 'mo-cs-row-note');
  tubes.append(tubeChips, tubeNote);
  const notes = moEl('textarea', 'mo-cs-notes', { 'aria-label': 'Notes', placeholder: 'Notes on this study', rows: '2', sceneId: 'media-organizer.colour.notes' });
  notes.addEventListener('input', () => { st.notes = notes.value.slice(0, 4000); save(); });
  rowsView.append(compare, tubes, notes);
  // Why pop-ups last, so they are drawn over the rows after their own (no z-index: house rule)
  for (const def of MO_COLOUR_ROWS) rowsView.appendChild(rowEls[def.id].why);
  rowsView.classList.add('mo-cs-rows-view');

  // ── the paints and what they reach ──
  const inUse = () => all.filter((p) => !st.tubesOff.includes(p.name));
  const activeRgb = () => rgbOf(st.colours[st.active]);
  const shownRgb = () => (st.shown ? rgbOf(st.shown) : activeRgb());
  const baseRgb = () => (st.base ? rgbOf(st.base) : activeRgb());
  const recipeOf = (rgb) => (gamut ? moRecipe(gamut, rgb) : null);
  const mixNow = () => { const r = recipeOf(shownRgb()); return st.mix || (r ? r.paints.map((p) => ({ name: p.name, parts: p.parts })) : []); };
  function regamut() {
    const list = inUse();
    gamut = list.length ? moGamut(list, rules) : null;
    wheelKey = '';
  }
  async function loadPaints() {
    const p = await moPlanPaintSet(io);
    setInfo = await moPaintSets(io);
    if (disposed) return;
    all = p.paints.map((x) => ({ ...x })); rules = { ...p.rules };
    st.tubesOff = st.tubesOff.filter((n) => all.some((x) => x.name === n));
    if (st.mix) { st.mix = st.mix.filter((m) => all.some((x) => x.name === m.name) || (m.name === 'Water' && rules.lighten === 'water')); if (!st.mix.length) st.mix = null; }
    regamut(); painted = true;
    if (!root.__moColourStudy) root.__moColourStudy = hook;
    change(false);
  }
  const onPaints = () => void loadPaints();
  document.addEventListener('mo:paints-changed', onPaints);
  // Choosing a set replaces the paints in use: asked first when they are in no set and would be lost.
  async function useSet(name) {
    if (!name || name === setInfo.current) { setKey = ''; change(false); return; }
    if (!setInfo.current && !setInfo.starter && !(await api.window.showConfirmModal({ message: `Use the set "${name}"?`, detail: 'The paints you have now are in no set. They will be replaced. Save them as a set first to keep them.', confirmLabel: 'Use Set' }))) { setKey = ''; change(false); return; }
    await moPaintSetUse(io, name);
  }
  // An open sheet follows its name when it is renamed from the home.
  const onRenamed = () => void deps.db.get('SELECT title FROM mo_colour_sheets WHERE id = ?', [sheetId]).then((r) => { if (r && r.title !== title && !disposed) { title = r.title; change(false); } }).catch(() => {});
  document.addEventListener(HOME, onRenamed);

  // ── changing things ──
  function syncHsl() { hsl = st.colours.map((h) => moRgbHsl(rgbOf(h))); }
  function setColour(i, rgb) { st.colours[i] = moHex(rgb); hsl[i] = moRgbHsl(rgb); }
  function setFromHsl(i) { st.colours[i] = moHex(moHslRgb(hsl[i][0], hsl[i][1], hsl[i][2])); }
  /** Colour i goes to this place on the wheel; in a harmony the rest turn and scale with it. */
  function moveDot(i, angle, strength) {
    const s = clamp(strength, 0, 1), offsets = MO_HARMONIES[st.harmony];
    if (!offsets || offsets.length !== st.colours.length) { hsl[i] = [moWheelHue(angle, st.wheel), s, hsl[i][2]]; setFromHsl(i); }
    else {
      const baseAngle = angle - offsets[i], k = hsl[i][1] > 0.001 ? s / hsl[i][1] : null;
      for (let j = 0; j < st.colours.length; j++) { hsl[j] = [moWheelHue(baseAngle + offsets[j], st.wheel), j === i || k == null ? s : clamp(hsl[j][1] * k, 0, 1), hsl[j][2]]; setFromHsl(j); }
    }
    st.shown = null; st.mix = null;
  }
  function setHarmony(type) {
    st.harmony = type;
    if (MO_HARMONIES[type]) { const [h, s, l] = hsl[st.active] || hsl[0]; st.colours = harmonyColours(type, h, s, l, st.wheel); st.active = 0; syncHsl(); st.shown = null; st.mix = null; }
    change();
  }
  function setWheel(model) {
    if (model === st.wheel) return;
    // The same places on the new wheel: the harmony is a shape on the wheel, not a set of hues.
    st.wheel = model;
    if (MO_HARMONIES[st.harmony] && MO_HARMONIES[st.harmony].length === st.colours.length) { const off = MO_HARMONIES[st.harmony], base = moWheelAngle(hsl[0][0], model); hsl.forEach((c, j) => { c[0] = moWheelHue(base + off[j], model); setFromHsl(j); }); }
    wheelKey = ''; st.shown = null; st.mix = null;
    change();
  }
  function setBase(v) {
    if (v === 'hex') { void askHex('The colour to study, as a hex code').then((rgb) => { if (rgb) { st.base = moHex(rgb); st.shown = st.base; } baseKey = ''; change(); }); return; }
    const p = all.find((x) => `paint:${x.name}` === v);
    st.base = p ? moHex(rgbOf(p.hex)) : v === 'keep' ? st.base : null;
    if (p) st.shown = st.base;
    change();
  }
  function show(next) { view = next; if (next !== 'bench') fixing = ''; change(false); const first = (next === 'bench' ? benchView : next === 'paints' ? paintsView : rowsView).querySelector('button, [tabindex="0"]'); if (first && next !== 'rows') queueMicrotask(() => first.focus()); }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = 0; void deps.db.run('UPDATE mo_colour_sheets SET state_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(st), new Date().toISOString(), sheetId]).then(() => document.dispatchEvent(new CustomEvent(HOME))).catch(() => {}); }, 350);
  }
  /** Something changed: keep it (unless told not to) and redraw once this frame. */
  function flush() { if (frame) cancelAnimationFrame(frame); clearTimeout(frameTimer); frame = 0; frameTimer = 0; if (!disposed && loaded) render(); }
  function change(keep = true) { if (keep) save(); if (!frame && !frameTimer) { frame = requestAnimationFrame(flush); frameTimer = setTimeout(flush, 50); } }
  async function copyRecipe() {
    const rgb = shownRgb(), mix = mixNow();
    const text = `${moColourName(rgb).name} ${moHex(rgb).toUpperCase()}, value ${say(moValue(rgb))}: ${mix.map((m) => `${m.parts} ${m.name}`).join(', ')}`;
    try { await navigator.clipboard.writeText(text); live.textContent = 'Recipe copied'; api.window.showInformationMessage('Recipe copied.'); } catch { api.window.showWarningMessage(text); }
  }

  // ── the wheel's dots and the palette (elements kept while dragged) ──
  const dots = [], palRows = [];
  function wheelPoint(e) {
    const r = wheelBox.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    return { angle: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360, strength: clamp(Math.hypot(dx, dy) / (r.width / 2), 0, 1) };
  }
  function dragOn(el, onMove) {
    const d = ui.onDragPress(el, (e) => {
      e.preventDefault();
      el.focus({ preventScroll: true });
      const move = (ev) => onMove(ev);
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      try { el.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      onMove(e);
    }, { pointerEvents: true });
    disposers.push(() => d.dispose());
  }
  function ensureDots() {
    while (dots.length < st.colours.length) {
      const i = dots.length;
      const dot = moEl('div', 'mo-cs-dot', { role: 'slider', tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': '359', 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter' });
      dot.textContent = String(i + 1);
      dot.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const a = moWheelAngle(hsl[i][0], st.wheel), step = e.shiftKey ? 15 : 3;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickColour(i); return; }
        if (/^Arrow/.test(e.key)) st.active = i;
        if (e.key === 'ArrowRight') moveDot(i, a + step, hsl[i][1]);
        else if (e.key === 'ArrowLeft') moveDot(i, a - step, hsl[i][1]);
        else if (e.key === 'ArrowUp') moveDot(i, a, hsl[i][1] + (e.shiftKey ? 0.1 : 0.03));
        else if (e.key === 'ArrowDown') moveDot(i, a, hsl[i][1] - (e.shiftKey ? 0.1 : 0.03));
        else return;
        e.preventDefault(); e.stopPropagation();
        change();
      });
      dragOn(dot, (ev) => { const p = wheelPoint(ev); st.active = i; moveDot(i, p.angle, p.strength); change(); });
      dotLayer.appendChild(dot); dots.push(dot);
    }
    dots.forEach((d, i) => d.classList.toggle('mo-hidden', i >= st.colours.length));
    while (palRows.length < st.colours.length) {
      const i = palRows.length;
      const row = moEl('div', 'mo-cs-pal-row');
      const pick = go(null, 'pick', `Colour ${i + 1}`, 'palette', { kind: 'ghost', tail: String(i + 1), args: [i] });
      pick.classList.add('mo-cs-pal-pick');
      const sw = moEl('span', 'mo-cs-sw', { 'aria-hidden': 'true' }), num = moEl('span', 'mo-cs-pal-n', { 'aria-hidden': 'true', textContent: String(i + 1) }), hex = moEl('span', 'mo-cs-pal-hex'), val = moEl('span', 'mo-practice-dim mo-cs-pal-val');
      pick.replaceChildren(num, sw, hex, val);
      const bar = moEl('div', 'mo-cs-vbar');
      const knob = moEl('span', 'mo-cs-vbar-knob', { 'aria-hidden': 'true' });
      bar.appendChild(knob);
      const setL = (l) => { hsl[i][2] = clamp(l, 0.02, 0.98); setFromHsl(i); st.active = i; st.shown = null; st.mix = null; change(); };
      disposers.push(moSliderKeys(bar, `Lightness of colour ${i + 1}`, { min: 2, max: 98, step: 1, big: 10, get: () => Math.round(hsl[i][2] * 100), set: (v) => setL(v / 100), text: (v) => `${Math.round(v)}%, value ${say(moValue(rgbOf(st.colours[i])))}` }));
      dragOn(bar, (ev) => { const r = bar.getBoundingClientRect(); setL((ev.clientX - r.left) / Math.max(1, r.width)); });
      const band = moEl('span', 'mo-cs-band');
      row.append(pick, bar, band);
      palList.appendChild(row); palRows.push({ row, pick, sw, hex, val, bar, knob, band });
    }
    palRows.forEach((r, i) => r.row.classList.toggle('mo-hidden', i >= st.colours.length));
  }
  // a press on the wheel itself moves the chosen colour there
  dragOn(canvas, (ev) => { const p = wheelPoint(ev); moveDot(st.active, p.angle, p.strength); change(); });
  // keys 1 to 9 choose a colour, anywhere on the sheet outside a field
  const onKey = (e) => {
    if (e.key === 'Escape' && whyOpen) { const r = rowEls[whyOpen]; whyOpen = ''; e.preventDefault(); e.stopPropagation(); change(false); if (r) r.whyBtn.focus(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    const n = Number(e.key);
    if (!(n >= 1 && n <= st.colours.length)) return;
    e.preventDefault(); e.stopPropagation();
    st.active = n - 1; st.shown = null; st.mix = null; change();
    if (st.source === 'wheel' && dots[n - 1] && root.contains(document.activeElement) && document.activeElement.classList.contains('mo-cs-dot')) dots[n - 1].focus();
  };
  root.addEventListener('keydown', onKey);

  // ── the picture ──
  function drawPicture() {
    if (!pictureImage) { picCanvas.width = 8; picCanvas.height = 8; return; }
    const w = pictureImage.naturalWidth, h = pictureImage.naturalHeight, k = Math.min(1, 720 / Math.max(w, h));
    picCanvas.width = Math.max(8, Math.round(w * k)); picCanvas.height = Math.max(8, Math.round(h * k));
    picCanvas.getContext('2d', { willReadFrequently: true }).drawImage(pictureImage, 0, 0, picCanvas.width, picCanvas.height);
  }
  function loadPicture() {
    pictureImage = null; pin = null;
    if (!picture) { drawPicture(); change(false); return; }
    const im = new Image();
    im.onload = () => { if (disposed) return; pictureImage = im; drawPicture(); change(false); };
    im.src = picture;
  }
  function pickAt(u, v) {
    if (!pictureImage) return;
    const g = picCanvas.getContext('2d', { willReadFrequently: true }), x = clamp(Math.round(u * picCanvas.width), 1, picCanvas.width - 2), y = clamp(Math.round(v * picCanvas.height), 1, picCanvas.height - 2);
    const d = g.getImageData(x - 1, y - 1, 3, 3).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    pin = { u, v };
    setColour(st.active, [r / 9, gg / 9, b / 9].map(Math.round)); st.shown = null; st.mix = null;
    live.textContent = `${moColourName(activeRgb()).name}, ${st.colours[st.active]}`;
    change();
  }
  dragOn(picCanvas, (ev) => { const r = picCanvas.getBoundingClientRect(); pickAt(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); });
  disposers.push(moPointKeys(picCanvas, 'Picture. Arrow keys move the picker, Enter takes the colour under it.', {
    move: (dx, dy) => { const p = pin || { u: 0.5, v: 0.5 }; pin = { u: clamp(p.u + dx / 100, 0, 1), v: clamp(p.v + dy / 100, 0, 1) }; change(false); },
    take: () => { const p = pin || { u: 0.5, v: 0.5 }; pickAt(p.u, p.v); },
  }));
  async function setPicture(url, from, colours) {
    picture = url || '';
    st.pictureFrom = from || ''; st.source = 'picture';
    await deps.db.run('UPDATE mo_colour_sheets SET picture = ? WHERE id = ?', [picture, sheetId]).catch(() => {});
    loadPicture();
    if (colours && colours.length) st.masses = colours.map(moHex).filter((h, i, a) => a.indexOf(h) === i).slice(0, 16);
    else {
      // the picture's own masses, once it has decoded
      const im = new Image();
      im.onload = () => { const c = moEl('canvas'); const k = Math.min(1, 160 / Math.max(im.naturalWidth, im.naturalHeight)); c.width = Math.max(4, Math.round(im.naturalWidth * k)); c.height = Math.max(4, Math.round(im.naturalHeight * k)); const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height); st.masses = moPalette(g.getImageData(0, 0, c.width, c.height).data, 6).map((s) => moHex(s.rgb)); change(); };
      im.src = picture;
    }
    change();
  }
  let pickSeq = 0, pickTimer = 0;
  async function findPhotos() {
    const mine = ++pickSeq, found = await deps.searchPhotos(pickSearch.value.trim()).catch(() => []);
    if (mine !== pickSeq || disposed) return;
    pickGrid.replaceChildren();
    for (const p of found.slice(0, 18)) {
      const b = go(pickGrid, 'pickPhoto', p.title || `Photo ${p.id}`, 'image', { kind: 'ghost', tail: String(p.id), args: [p.id, p.title || ''] });
      b.classList.add('mo-plans-pick'); b.setAttribute('aria-label', `Use ${p.title || `photo ${p.id}`}`);
      const img = moEl('img', null, { alt: '' });
      b.replaceChildren(img); deps.thumb(img, p.id);
    }
    if (!found.length) pickGrid.appendChild(moEl('div', 'mo-practice-dim', { textContent: 'No photos match.' }));
  }
  function togglePicker(on) { choosing = on; picker.classList.toggle('mo-hidden', !on); choosePicBtn.setAttribute('aria-expanded', String(on)); if (on) { void findPhotos(); pickSearch.focus(); } else if (picker.contains(document.activeElement)) choosePicBtn.focus(); }
  pickSearch.addEventListener('input', () => { clearTimeout(pickTimer); pickTimer = setTimeout(findPhotos, 220); });
  picker.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); togglePicker(false); } });
  async function choosePlan() {
    const plans = await deps.plans().catch(() => []);
    if (!plans.length) { api.window.showInformationMessage('There are no painting plans yet.'); return; }
    const at = root.querySelector('[data-px-id="media-organizer.colour.choosePlan"]');
    ui.createMenu(at, { id: 'media-organizer.colour.plans', label: 'Choose Plan', items: plans.slice(0, 30).map((p) => ({ label: p.title, onSelect: async () => { const snap = await deps.planSnapshot(p.id); if (snap && snap.picture) await setPicture(snap.picture, `From the plan ${snap.title}`, snap.colours || []); else api.window.showWarningMessage('That plan’s picture could not be drawn.'); } })) });
  }

  // ── drawing what is there ──
  const bandSet = (el, word) => { el.textContent = word || ''; el.className = `mo-cs-band mo-pc-close${word ? ` mo-pc-close--${word.toLowerCase().replace(/\s+/g, '-')}` : ''}`; };
  const keepFocus = (within, redraw) => { const id = within.contains(document.activeElement) && document.activeElement.getAttribute('data-px-id'); redraw(); if (id) { const el = within.querySelector(`[data-px-id="${CSS.escape(id)}"]`) || within.querySelector('button:not([disabled]), [tabindex="0"]'); if (el) el.focus(); } };
  const benchOwned = [], paintsOwned = [];
  const drop = (list) => { for (const d of list.splice(0)) { try { d(); } catch { /* gone */ } } };
  let chipKey = '', benchKey = '', paintsKey = '', tubeKey = '', massKey = '', baseKey = '', setKey = '';

  function render() {
    titleEl.textContent = title;
    root.classList.toggle('is-grey', st.valueCheck); root.dataset.grey = String(st.valueCheck);
    pressed(greyBtn, st.valueCheck); pressed(hatchBtn, st.hatch); pressed(editBtn, view === 'bench'); pressed(paintsBtn, view === 'paints');
    if (sourceSeg.value !== st.source) sourceSeg.value = st.source;
    if (wheelSeg.value !== st.wheel) wheelSeg.value = st.wheel;
    if (harmonyDd.value !== st.harmony) harmonyDd.value = st.harmony;
    const sk = JSON.stringify(setInfo);
    if (sk !== setKey) { setKey = sk; setDd.setItems([...(setInfo.current ? [] : [{ value: '', label: setInfo.starter ? 'Starter Paints' : 'Paints in No Set' }]), ...setInfo.sets.map((s) => ({ value: s.name, label: `${s.name} (${s.count})` }))], setInfo.current); }
    wheelBlock.classList.toggle('mo-hidden', st.source !== 'wheel'); picBlock.classList.toggle('mo-hidden', st.source !== 'picture');
    rowsView.classList.toggle('mo-hidden', view !== 'rows'); benchView.classList.toggle('mo-hidden', view !== 'bench'); paintsView.classList.toggle('mo-hidden', view !== 'paints');

    ensureDots();
    const a = activeRgb(), l = hsl[st.active] ? hsl[st.active][2] : 0.5;
    // the wheel, only when what it shows has changed
    if (st.source === 'wheel') {
      const css = Math.round(clamp(wheelBox.clientWidth || 260, 120, 320));
      const key = [css, st.wheel, Math.round(l * 200), st.hatch, gamut ? gamut.key : ''].join('|');
      if (key !== wheelKey) { wheelKey = key; painter.size(css, window.devicePixelRatio || 1); painter.draw({ model: st.wheel, lightness: l, gamut, hatch: st.hatch }); }
      wheelCap.textContent = `Lightness ${Math.round(l * 100)}%.${st.hatch && gamut ? ' Hatched: out of reach.' : ''}`;
      st.colours.forEach((hex, i) => {
        const d = dots[i], ang = moWheelAngle(hsl[i][0], st.wheel), rad = (hsl[i][1] * 50 * (css - 2)) / css;
        d.style.left = `${50 + Math.sin((ang * Math.PI) / 180) * rad}%`; d.style.top = `${50 - Math.cos((ang * Math.PI) / 180) * rad}%`;
        d.style.background = hex; d.style.color = moValue(rgbOf(hex)) > 5 ? 'black' : 'white';
        d.classList.toggle('is-on', i === st.active);
        d.setAttribute('aria-label', `Colour ${i + 1}, ${moColourName(rgbOf(hex)).name}. Arrow keys turn the palette and change its strength.`);
        d.setAttribute('aria-valuenow', String(Math.round(ang))); d.setAttribute('aria-valuetext', `${hex}, ${Math.round(ang)} degrees, strength ${Math.round(hsl[i][1] * 100)}%`);
      });
    }
    st.colours.forEach((hex, i) => {
      const r = palRows[i], rgb = rgbOf(hex), rec = recipeOf(rgb);
      r.row.classList.toggle('is-on', i === st.active);
      r.sw.style.background = hex; r.hex.textContent = hex.toUpperCase(); r.val.textContent = say(moValue(rgb));
      r.pick.setAttribute('aria-label', `Colour ${i + 1}, ${moColourName(rgb).name}, ${hex}, value ${say(moValue(rgb))}${rec && rec.paints.length ? `. ${rec.closeness}: ${rec.paints.map((p) => `${p.parts} ${p.name}`).join(', ')}` : ''}`); r.pick.setAttribute('aria-pressed', String(i === st.active));
      r.knob.style.left = `${hsl[i][2] * 100}%`; r.bar.setAttribute('aria-valuenow', String(Math.round(hsl[i][2] * 100)));
      bandSet(r.band, rec ? rec.closeness : '');
      r.band.title = rec ? rec.paints.map((p) => `${p.parts} ${p.name}`).join(', ') : '';
    });
    palHint.textContent = st.source === 'wheel' ? `Keys 1 to ${st.colours.length} choose a colour. On a dot, the arrow keys turn the palette and change its strength.` : `Keys 1 to ${st.colours.length} choose which palette colour a press on the picture replaces.`;

    // the picture
    if (st.source === 'picture') {
      picBox.classList.toggle('mo-hidden', !pictureImage);
      picCap.textContent = pictureImage ? `${st.pictureFrom ? `${st.pictureFrom}. ` : ''}Press anywhere to take that colour.` : 'No picture on this sheet. Choose a plan or a picture from the library, or stay with the wheel.';
      picPin.classList.toggle('mo-hidden', !pin);
      if (pin) { picPin.style.left = `${pin.u * 100}%`; picPin.style.top = `${pin.v * 100}%`; }
      const mk = st.masses.join() + (gamut ? gamut.key : '');
      massTitle.classList.toggle('mo-hidden', !st.masses.length);
      if (mk !== massKey) {
        massKey = mk;
        keepFocus(massList, () => {
          massList.replaceChildren();
          st.masses.forEach((hex, i) => {
            const rgb = rgbOf(hex), rec = recipeOf(rgb);
            const b = go(massList, 'mass', `${moColourName(rgb).name}, value ${say(moValue(rgb))}${rec ? `, ${rec.closeness}` : ''}`, 'pipette', { kind: 'ghost', tail: String(i + 1), args: [i] });
            b.classList.add('mo-cs-mass');
            const sw = moEl('span', 'mo-cs-sw', { 'aria-hidden': 'true' }); sw.style.background = hex;
            const band = moEl('span', 'mo-cs-band'); bandSet(band, rec ? rec.closeness : '');
            b.replaceChildren(sw, moEl('span', 'mo-cs-mass-name', { textContent: moColourName(rgb).name }), moEl('span', 'mo-practice-dim', { textContent: say(moValue(rgb)) }), band);
          });
        });
      }
    }

    // the card
    const rgb = shownRgb(), rec = recipeOf(rgb), mix = mixNow(), mixRgb = (st.mix ? moMixOfParts(inUse(), mix) : rec && rec.paints.length ? rec.rgb : null);
    const vStep = clamp(Math.round(moValue(rgb)), 0, 10);
    ground.style.background = groundHex(st.ground);
    if (groundDd.value !== st.ground) groundDd.value = st.ground;
    targetEl.style.background = moHex(rgb); mixEl.style.background = mixRgb ? moHex(mixRgb) : 'transparent';
    targetEl.setAttribute('aria-label', `Target, ${moHex(rgb)}`); mixEl.setAttribute('aria-label', mixRgb ? `Your mix, ${moHex(mixRgb)}` : 'No mix yet');
    nameEl.textContent = moColourName(rgb).name;
    subEl.textContent = `${moHex(rgb).toUpperCase()} · value ${say(moValue(rgb))}`; subEl.title = `${VALUE_WORDS[vStep]} colour`;
    const drift = mixRgb ? moDrift(rgb, mixRgb) : null;
    bandSet(bandEl, drift ? drift.closeness : gamut || painted ? '' : 'Working it out');
    diffEl.textContent = drift ? `${say(drift.de * 100)} off${drift.closeness === 'Far' ? ' · out of reach' : ''}` : all.length ? '' : 'Add paints to see a recipe.';
    studyBtn.disabled = moHex(rgb) === moHex(baseRgb()); putBtn.disabled = !st.shown || st.shown === st.colours[st.active];
    const roleOf = (name) => { const p = rec && rec.paints.find((x) => x.name === name); return p ? p.role : ''; };
    const ck = JSON.stringify([mix, st.mix ? 1 : 0, rec ? rec.paints.map((p) => p.role) : 0]);
    if (ck !== chipKey) {
      chipKey = ck;
      keepFocus(chips, () => {
        chips.replaceChildren(); partsBar.replaceChildren(); roles.clear();
        for (const m of mix) {
          const p = all.find((x) => x.name === m.name), role = !st.mix && roleOf(m.name);
          if (role) roles.set(m.name, role);
          const seg = moEl('span'); seg.style.flex = String(m.parts); if (p) seg.style.background = p.hex; partsBar.appendChild(seg);
          const name = `${m.parts} part${m.parts === 1 ? '' : 's'} ${m.name}${role ? `: ${role.toLowerCase()}` : ''}`;
          const c = go(chips, 'role', m.name, null, { kind: 'ghost', tail: moSlug(m.name), args: [m.name], title: name });
          c.classList.add('mo-cs-chip'); c.setAttribute('data-paint', m.name); c.setAttribute('aria-label', name);
          const sw = moEl('span', 'mo-cs-sw mo-cs-sw-sm', { 'aria-hidden': 'true' }); if (p) sw.style.background = p.hex;
          c.replaceChildren(sw, moEl('b', null, { textContent: String(m.parts) }), moEl('span', null, { textContent: m.name }));
          c.addEventListener('pointerenter', () => showRole(m.name)); c.addEventListener('pointerleave', () => showRole(roleShown));
          c.addEventListener('focus', () => showRole(m.name)); c.addEventListener('blur', () => showRole(roleShown));
        }
        if (roleShown && !roles.has(roleShown)) roleShown = '';
        showRole(roleShown);
      });
    }

    const tell = st.mix && drift ? (drift.text === 'the same' ? 'Your mix matches the target.' : `Your mix is ${drift.text} than the target.`) : st.shown ? `${moColourName(rgb).name}, ${moHex(rgb)}, value ${say(moValue(rgb))}${rec ? `, ${rec.closeness}` : ''}` : '';
    if (tell !== said) { said = tell; if (tell) live.textContent = tell; }
    if (view === 'rows') renderRows(rec);
    if (view === 'bench') {
      const key = JSON.stringify([mix, moHex(rgb), fixing, gamut ? gamut.key : '', !!st.mix]);
      if (key !== benchKey) {
        benchKey = key;
        keepFocus(benchView, () => { drop(benchOwned); moDrawBench({ ui, view: benchView, go, goIcon, owned: benchOwned, mix, edited: !!st.mix, rec, drift, paints: inUse(), all, rules, fixing, onAdd: (name) => { st.mix = [...mix, { name, parts: 1 }]; change(); } }); });
        warmSubs(mix.map((m) => m.name), rgb);
      }
    }
    if (view === 'paints') {
      const key = JSON.stringify([all, setInfo]);
      if (key !== paintsKey) {
        paintsKey = key;
        keepFocus(paintsView, () => { drop(paintsOwned); moDrawPaints({ ui, view: paintsView, go, goIcon, owned: paintsOwned, all, setInfo, onAddCommon: (p) => void moPaintsEdit(io, (list) => { list.push({ ...p }); }), onStrength: (name, v) => void moPaintsEdit(io, (list) => { const x = list.find((y) => y.name === name); if (x) { if (Math.abs(v - 1) < 0.05) delete x.strength; else x.strength = Math.round(v * 10) / 10; } }) }); });
      }
    }
  }

  function renderRows(rec) {
    const base = baseRgb(), rows = moVariationRows(base, { cells: 10, light: st.light }), shown = moHex(shownRgb());
    const bk = JSON.stringify([all.map((p) => p.name), st.base]);
    if (bk !== baseKey) {
      baseKey = bk;
      const paintOfBase = all.find((p) => moHex(rgbOf(p.hex)) === st.base);
      baseDd.setItems([{ value: '', label: 'The Chosen Palette Colour' }, ...(st.base && !paintOfBase ? [{ value: 'keep', label: `${moColourName(rgbOf(st.base)).name} ${st.base.toUpperCase()}`, color: st.base }] : []), ...all.map((p) => ({ value: `paint:${p.name}`, label: p.name, color: p.hex })), { value: 'hex', label: 'A Hex Code…' }], !st.base ? '' : paintOfBase ? `paint:${paintOfBase.name}` : 'keep');
    }
    // what the sentences name: the fixes for the base colour's own recipe
    const bRec = recipeOf(base), bMix = bRec ? bRec.paints.map((p) => ({ name: p.name, parts: p.parts })) : [], fixes = {};
    if (bMix.length) for (const k of ['bright', 'dark', 'light', 'warm', 'cool']) fixes[k] = moFixMix(inUse(), bMix, k, undefined, rules);
    for (const def of MO_COLOUR_ROWS) {
      const r = rowEls[def.id], list = rows[def.id];
      r.cells.forEach((c, i) => {
        const cell = list[i], hex = moHex(cell.rgb);
        c.style.background = hex; c.dataset.hex = hex;
        c.classList.toggle('is-base', !!cell.base); c.classList.toggle('is-shown', hex === shown);
        c.setAttribute('aria-label', `${moColourName(cell.rgb).name}, ${hex}, value ${say(cell.value)}${cell.base ? ', the base' : ''}`); c.title = `${hex.toUpperCase()}, value ${say(cell.value)}`;
        if (!r.cells.includes(document.activeElement)) c.tabIndex = (list.some((x) => moHex(x.rgb) === shown) ? hex === shown : !!cell.base || (i === 0 && !list.some((x) => x.base))) ? 0 : -1;
        c.setAttribute('aria-pressed', String(hex === shown));
        if (r.nums) r.nums.children[i].textContent = say(cell.value);
      });
      const note = moRowNote(def.id, { value: moValue(base), light: st.light, fixes });
      if (note.text !== r.noteKey) {
        r.noteKey = note.text;
        r.note.replaceChildren(moEl('div', 'mo-cs-note-fact', { textContent: note.fact }));
        for (const [label, name] of note.advice) {
          const line = moEl('div', 'mo-cs-note-advice');
          const p = name && all.find((x) => x.name === name);
          if (!name) line.textContent = label;
          else { line.append(moEl('span', null, { textContent: `${label}: ` })); if (p) { const d = moEl('span', 'mo-cs-sw mo-cs-sw-sm', { 'aria-hidden': 'true' }); d.style.background = p.hex; line.append(d); } line.append(moEl('span', 'mo-cs-note-paint', { textContent: name })); }
          r.note.appendChild(line);
        }
      }
      const open = whyOpen === def.id;
      r.why.classList.toggle('mo-hidden', !open); r.whyBtn.setAttribute('aria-expanded', String(open));
      if (open) { r.why.style.top = `${r.whyBtn.offsetTop + r.whyBtn.offsetHeight + 4}px`; r.why.style.left = `${r.el.offsetLeft}px`; }
      if (r.lightSeg && r.lightSeg.value !== st.light) r.lightSeg.value = st.light;
      if (r.greyBtn) { pressed(r.greyBtn, st.twinsGrey); r.el.classList.toggle('is-grey', st.twinsGrey); }
    }
    // compare: the base beside the colour shown
    const b = moHex(base), s = moHex(shownRgb()), dv = moValue(shownRgb()) - moValue(base);
    [b, s, b, s].forEach((h, i) => { cmp[i].style.background = h; });
    verdict.textContent = s === b ? 'Press a cell to compare.' : Math.abs(dv) < 0.25 ? 'Same value.' : `Shown is ${say(Math.abs(dv))} ${dv > 0 ? 'lighter' : 'darker'}.`;
    // the limited palette test
    const tk = JSON.stringify([all.map((p) => p.name + p.hex), st.tubesOff]);
    if (tk !== tubeKey) {
      tubeKey = tk;
      keepFocus(tubeChips, () => {
        tubeChips.replaceChildren();
        for (const p of all) {
          const on = !st.tubesOff.includes(p.name);
          const b2 = go(tubeChips, 'tubeOn', p.name, 'palette', { kind: 'ghost', tail: moSlug(p.name), args: [p.name], title: on ? `Mix without ${p.name}` : `Use ${p.name} again` });
          b2.classList.add('mo-cs-tube-chip'); pressed(b2, on);
          const sw = moEl('span', 'mo-cs-sw mo-cs-sw-sm', { 'aria-hidden': 'true' }); sw.style.background = p.hex;
          b2.replaceChildren(sw, moEl('span', null, { textContent: p.name }));
        }
      });
    }
    const set = [...new Set([...st.colours, ...st.masses])], counts = { close: 0, near: 0, far: [] };
    for (const h of set) { const r2 = recipeOf(rgbOf(h)); if (!r2) continue; if (r2.closeness === 'Far') counts.far.push(moColourName(rgbOf(h)).name); else if (r2.closeness === 'Near') counts.near++; else counts.close++; }
    tubeNote.textContent = !gamut ? 'Turn on at least one paint.' : `With ${inUse().length === all.length ? `all ${all.length}` : `${inUse().length} of your ${all.length}`} paints: ${counts.close} of this sheet’s ${set.length} colours ${counts.close === 1 ? 'is' : 'are'} close, ${counts.near} near${counts.far.length ? `, ${counts.far.length} out of reach (${counts.far.join(', ')})` : ''}. Turn a paint off to see what you lose.`;
    if (document.activeElement !== notes && notes.value !== st.notes) notes.value = st.notes;
    void rec;
  }

  // (bench and paints: colour-study-panels.js)
  // What stands in for a paint takes a few gamuts to work out: done ahead, one paint at a time, once the
  // bench is drawn, so the Swap menu opens at once.
  const subsCache = new Map();
  let subsTimer = 0;
  const subsFor = (name, rgb) => { const k = `${gamut ? gamut.key : ''}|${moHex(rgb)}|${name}`; if (!subsCache.has(k)) { if (subsCache.size > 60) subsCache.clear(); subsCache.set(k, moSubstitutes(inUse(), rules, rgb, name)); } return subsCache.get(k); };
  function warmSubs(names, rgb) {
    clearTimeout(subsTimer);
    const next = names.find((n) => !subsCache.has(`${gamut ? gamut.key : ''}|${moHex(rgb)}|${n}`));
    if (next && gamut) subsTimer = setTimeout(() => { if (!disposed && view === 'bench') { subsFor(next, rgb); warmSubs(names, rgb); } }, 30);
  }
  function swapMenu(name) {
    const rgb = shownRgb(), at = benchView.querySelector(`[data-px-id="${CSS.escape(idOf('swap', moSlug(name)))}"]`), subs = subsFor(name, rgb);
    if (!at) return;
    ui.createMenu(at, { id: 'media-organizer.colour.swapMenu', label: `Without ${name}`, items: subs.length ? subs.map((s) => ({ label: `${s.paints.map((p) => `${p.parts} ${p.name}`).join(', ')} (${s.closeness}, ${say(s.de * 100)})`, tooltip: s.drift.text === 'the same' ? 'Matches the target' : `${s.drift.text.charAt(0).toUpperCase()}${s.drift.text.slice(1)} than the target`, onSelect: () => { st.mix = s.paints.map((p) => ({ name: p.name, parts: p.parts })); change(); } })) : [{ label: 'No other paint can stand in', disabled: true }] });
  }

  // ── what each command does on this sheet (MO_COLOUR_ACTIONS) ──
  const pickColour = (i) => { if (i >= 0 && i < st.colours.length) { st.active = i; st.shown = null; st.mix = null; change(); } };
  const setParts = (name, n) => { const mix = mixNow(), next = (mix.some((m) => m.name === name) ? mix.map((m) => (m.name === name ? { name, parts: clamp(n, 0, 24) } : m)) : [...mix, { name, parts: clamp(n, 1, 24) }]).filter((m) => m.parts > 0); st.mix = next; change(); };
  const partsOf = (name) => (mixNow().find((m) => m.name === name) || { parts: 0 }).parts;
  const askHex = async (prompt, value) => { const t = await api.window.showInputBox({ prompt, ...(value ? { value } : {}), placeHolder: 'A hex code, like 8A3F22' }); const rgb = moHexRgb(t); if (!rgb && t) api.window.showWarningMessage('That is not a hex colour, like 8A3F22.'); return rgb; };
  const acts = {
    myPaints: () => show(view === 'paints' ? 'rows' : 'paints'),
    closePaints: () => show('rows'), closeBench: () => show('rows'),
    editMix: () => show(view === 'bench' ? 'rows' : 'bench'),
    valueCheck() { st.valueCheck = !st.valueCheck; change(); },
    hatch() { st.hatch = !st.hatch; change(); },
    twinsGrey() { st.twinsGrey = !st.twinsGrey; change(); },
    why(row) { whyOpen = whyOpen === row ? '' : row; change(false); },
    role(name) { roleShown = roleShown === name ? '' : name; showRole(roleShown); },
    choosePlan: () => choosePlan(),
    choosePicture: () => togglePicker(!choosing),
    async pickPhoto(id, name) { togglePicker(false); const url = await deps.photoPicture(id, 720).catch(() => null); if (url) await setPicture(url, name ? `From ${name}` : 'From the library', null); else api.window.showWarningMessage('That photo is not on disk right now.'); },
    mass(i) { const hex = st.masses[i]; if (hex) { setColour(st.active, rgbOf(hex)); st.shown = null; st.mix = null; change(); } },
    pick: (i) => pickColour(i),
    cell(row, i) { const c = rowEls[row] && rowEls[row].cells[i]; if (c && c.dataset.hex) { st.shown = c.dataset.hex; st.mix = null; change(); } },
    copyRecipe: () => copyRecipe(),
    studyThis() { st.base = moHex(shownRgb()); change(); },
    putOnPalette() { setColour(st.active, shownRgb()); st.shown = null; change(); },
    tubeOn(name) { st.tubesOff = st.tubesOff.includes(name) ? st.tubesOff.filter((n) => n !== name) : [...st.tubesOff, name]; st.mix = null; regamut(); change(); },
    resetMix() { st.mix = null; change(); },
    less: (name) => setParts(name, partsOf(name) - 1),
    more: (name) => setParts(name, partsOf(name) + 1),
    dropPaint: (name) => setParts(name, 0),
    nudge: (name) => setParts(name, partsOf(name) + 1),
    swap: (name) => swapMenu(name),
    fix(problem) { fixing = fixing === problem ? '' : problem; const f = fixing && mixNow().length ? moFixMix(inUse(), mixNow(), fixing, undefined, rules) : null; if (fixing) live.textContent = f ? f.text : 'None of your paints moves this mix that way.'; change(false); },
    async saveSet() { const n = await api.window.showInputBox({ prompt: 'Name this set of paints', value: setInfo.current || '', placeHolder: 'Studio Oils' }); if (n && String(n).trim()) await moPaintSetSave(io, n); },
    async deleteSet() { if (setInfo.current && await api.window.showConfirmModal({ message: `Delete the set "${setInfo.current}"?`, detail: 'The paints in use stay as they are.', confirmLabel: 'Delete', danger: true })) await moPaintSetRemove(io, setInfo.current); },
    starterPaints: () => moPaintsEdit(io, () => MO_STARTER_PAINTS.map((p) => ({ ...p }))),
    async paintColour(name) { const p = all.find((x) => x.name === name); const rgb = p && await askHex(`The colour of ${name}, as a hex code`, p.hex.slice(1)); if (rgb) await moPaintsEdit(io, (list) => { const x = list.find((y) => y.name === name); if (x) x.hex = moHex(rgb); }); },
    removePaint: (name) => moPaintsEdit(io, (list) => list.filter((y) => y.name !== name)),
    async customPaint() {
      const n = await api.window.showInputBox({ prompt: 'Name the paint', placeHolder: 'Paint name' });
      if (!n || !String(n).trim()) return;
      const name = String(n).trim().slice(0, 40);
      if (all.some((p) => p.name === name)) { api.window.showWarningMessage(`You already have ${name}.`); return; }
      const rgb = await askHex(`The colour of ${name}, as a hex code`);
      if (rgb) await moPaintsEdit(io, (list) => { list.push({ name, hex: moHex(rgb) }); });
    },
  };
  disposers.push(moColourSheetOpened({ root, act: (name, ...args) => (acts[name] ? acts[name](...args) : undefined) }));

  // ── load, and the way out ──
  const hook = {
    state() {
      flush();
      const rgb = shownRgb(), rec = recipeOf(rgb), mix = mixNow(), mixRgb = st.mix ? moMixOfParts(inUse(), mix) : rec ? rec.rgb : null, rows = moVariationRows(baseRgb(), { cells: 10, light: st.light });
      return { sheetId, title, wheel: st.wheel, harmony: st.harmony, colours: st.colours.slice(), active: st.active, shown: moHex(rgb), base: moHex(baseRgb()), light: st.light, valueCheck: st.valueCheck, hatch: st.hatch, twinsGrey: st.twinsGrey, source: st.source, view, paints: inUse().map((p) => p.name), allPaints: all.map((p) => p.name), paintSet: setInfo.current, paintSets: setInfo.sets.map((s) => s.name), mix: st.mix || view === 'bench' ? mix.map((m) => ({ ...m })) : null,
        recipe: rec ? { paints: rec.paints.map((p) => ({ ...p })), hex: rec.hex, de: rec.de, closeness: rec.closeness } : null, mixHex: mixRgb ? moHex(mixRgb) : null, drift: mixRgb ? moDrift(rgb, mixRgb) : null,
        rows: Object.fromEntries(Object.entries(rows).map(([k, list]) => [k, list.map((c) => moHex(c.rgb))])), rowValues: Object.fromEntries(Object.entries(rows).map(([k, list]) => [k, list.map((c) => c.value)])), masses: st.masses.slice(), hasPicture: !!picture };
    },
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => change(false)) : null;
  if (ro) ro.observe(wheelBox);
  (async () => {
    const row = await deps.db.get('SELECT * FROM mo_colour_sheets WHERE id = ?', [sheetId]).catch(() => null);
    if (disposed) return;
    if (!row) { root.replaceChildren(moEl('div', 'mo-practice-empty', { textContent: 'This colour study is gone.' })); return; }
    title = row.title; st = cleanState(parse(row.state_json, null)); picture = row.picture || '';
    syncHsl(); notes.value = st.notes; loaded = true;
    loadPicture();
    change(false);
    // the gamut takes a moment: after the first paint, never in the way of it
    setTimeout(() => { if (!disposed) void loadPaints(); }, 0);
  })();

  return {
    dispose() {
      disposed = true;
      if (saveTimer) { clearTimeout(saveTimer); void deps.db.run('UPDATE mo_colour_sheets SET state_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(st), new Date().toISOString(), sheetId]).then(() => document.dispatchEvent(new CustomEvent(HOME))).catch(() => {}); }
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(frameTimer); clearTimeout(pickTimer); clearTimeout(subsTimer);
      if (ro) ro.disconnect();
      document.removeEventListener('mo:paints-changed', onPaints); document.removeEventListener(HOME, onRenamed);
      root.removeEventListener('keydown', onKey);
      drop(benchOwned); drop(paintsOwned); drop(disposers);
      container.replaceChildren();
    },
  };
}
