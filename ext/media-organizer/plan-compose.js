// plan-compose.js — the plan's first step: the canvas size, the crop and the
// composition guides. The crop keeps the canvas proportions, or is free and
// the canvas follows it; Straighten turns the picture under an upright frame.
// The guides (thirds, the golden grid, the golden spiral, diagonals and the
// harmonic triangles) are drawn inside the frame, so the crop can be judged
// against them before anything is painted.
//
// The crop lives in the turned picture's units (0..1), as before; with an
// angle it is the box the output is cut from, turned about its own centre.
// On screen Compose shows the whole picture turned by the angle with the frame
// upright over it: a box's centre on screen is the picture's centre plus the
// box's offset turned back by the angle.

import { moEl } from './dom.js';
import { moBoxKeys } from './keys.js';
import { moPlanChoice, moPlanHint, moPlanSection, moPlanSlider, moPlanSwitch } from './plan-kit.js';

export const MO_PLAN_GUIDES = [
  ['none', 'None', '<rect x="2" y="2" width="30" height="20"/>'],
  ['thirds', 'Thirds', '<rect x="2" y="2" width="30" height="20"/><path d="M12 2v20M22 2v20M2 8.7h30M2 15.3h30"/>'],
  ['golden', 'Golden Grid', '<rect x="2" y="2" width="30" height="20"/><path d="M13.5 2v20M20.5 2v20M2 9.6h30M2 14.4h30"/>'],
  ['spiral', 'Spiral', '<rect x="2" y="2" width="30" height="20"/><path d="M14.4 22A12.4 12.4 0 0 1 2 9.6 7.6 7.6 0 0 1 9.6 2a12.4 12.4 0 0 1 12.4 12.4"/>'],
  ['diagonals', 'Diagonals', '<rect x="2" y="2" width="30" height="20"/><path d="M2 2l30 20M32 2 2 22M2 2l20 20M32 2 12 22"/>'],
  ['triangles', 'Triangles', '<rect x="2" y="2" width="30" height="20"/><path d="M2 22 32 2M2 2l10 14M32 22 22 8"/>'],
];
const PROPORTIONS = [['free', 'Free'], ['photo', 'Photo'], ['5:4', '5:4'], ['4:3', '4:3'], ['3:2', '3:2'], ['1:1', '1:1']];
const ACTIONS = ['composeRotateLeft', 'composeRotateRight', 'composeFlipH', 'composeFlipV', 'composeResetCrop', 'composeSwapCanvas', 'composeGuide', 'composeTurnGuide'];
const PHI = (1 + Math.sqrt(5)) / 2;
const round1 = (v) => Math.round(v * 10) / 10;

const open = new Set();
let lastUsed = null;
const inUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanComposeActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = inUse(); return p ? p.act(a, ...args) : undefined; }));
}

// ── the guides ──
/** Draws `guide` inside the box (x, y, w, h) of a 2D context; `turn` (0..3) mirrors it, `k` scales the lines; colours: { line, edge }. */
export function moPlanDrawGuide(g, x, y, w, h, guide, turn, k, colours) {
  if (!guide || guide === 'none') return;
  const fx = turn & 1, fy = turn & 2;
  const P = (u, v) => [x + (fx ? 1 - u : u) * w, y + (fy ? 1 - v : v) * h];
  const paths = [];
  const line = (u1, v1, u2, v2) => paths.push([P(u1, v1), P(u2, v2)]);
  if (guide === 'thirds') for (const f of [1 / 3, 2 / 3]) { line(f, 0, f, 1); line(0, f, 1, f); }
  if (guide === 'golden') for (const f of [1 / PHI / PHI, 1 / PHI]) { line(f, 0, f, 1); line(0, f, 1, f); }
  if (guide === 'diagonals') {
    line(0, 0, 1, 1); line(1, 0, 0, 1);
    const s = Math.min(w, h); // the 45° lines from each corner
    line(0, 0, s / w, s / h); line(1, 0, 1 - s / w, s / h); line(0, 1, s / w, 1 - s / h); line(1, 1, 1 - s / w, 1 - s / h);
  }
  if (guide === 'triangles') {
    line(0, 1, 1, 0);
    // From the two other corners, square to that diagonal (worked in pixels, so it stays square on any frame).
    const foot = (px, py) => { const ax = 0, ay = h, bx = w, by = 0, dx = bx - ax, dy = by - ay, t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy); return [(ax + t * dx) / w, (ay + t * dy) / h]; };
    const a = foot(0, 0), b = foot(w, h);
    line(0, 0, a[0], a[1]); line(1, 1, b[0], b[1]);
  }
  const curves = [];
  if (guide === 'spiral') {
    // A golden rectangle cut into squares, a quarter turn in each, stretched to the frame.
    let rx = 0, ry = 0, rw = PHI, rh = 1;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const d = i % 4, s = Math.min(rw, rh);
      let cx, cy, a0;
      if (d === 0) { cx = rx + s; cy = ry + s; a0 = Math.PI; line((rx + s) / PHI, ry, (rx + s) / PHI, ry + rh); rx += s; rw -= s; }
      else if (d === 1) { cx = rx; cy = ry + s; a0 = 1.5 * Math.PI; line(rx / PHI, ry + s, (rx + rw) / PHI, ry + s); ry += s; rh -= s; }
      else if (d === 2) { cx = rx + rw - s; cy = ry; a0 = 0; line((rx + rw - s) / PHI, ry, (rx + rw - s) / PHI, ry + rh); rw -= s; }
      else { cx = rx + s; cy = ry + rh - s; a0 = 0.5 * Math.PI; line(rx / PHI, ry + rh - s, (rx + rw) / PHI, ry + rh - s); rh -= s; }
      for (let j = 0; j <= 16; j++) { const t = a0 + (j / 16) * (Math.PI / 2); pts.push(P((cx + s * Math.cos(t)) / PHI, cy + s * Math.sin(t))); }
    }
    curves.push(pts);
  }
  const stroke = (colour, width, alpha) => {
    g.save(); g.strokeStyle = colour; g.lineWidth = width * k; g.globalAlpha = alpha; g.lineCap = 'round';
    for (const [a, b] of paths) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    for (const c of curves) { g.beginPath(); g.moveTo(c[0][0], c[0][1]); for (const p of c) g.lineTo(p[0], p[1]); g.stroke(); }
    g.restore();
  };
  stroke(colours.edge, 3, 0.6);
  stroke(colours.line, guide === 'spiral' ? 1.6 : 1.4, 1);
}

/**
 * ctx: { api, state, root, frame, cropBox, rotated() -> the turned picture's size,
 *   afterRecipeChange(record, keepPanel), requestRender(), setCanvas(w, h), moDropdown, presets }.
 * The editor calls panel() for the step, drawOverlay() and placeBox() after each draw.
 */
export function moPlanCompose(ctx) {
  const { api, state } = ctx;
  const ui = api.ui;
  const disposers = [];

  // ── boxes: pixels of the turned picture, { cx, cy, w, h } ──
  const view = () => ctx.rotated();
  const rad = () => ((Number(state.recipe.angle) || 0) * Math.PI) / 180;
  const toPx = (c) => { const v = view(); return { cx: (c.x + c.w / 2) * v.w, cy: (c.y + c.h / 2) * v.h, w: c.w * v.w, h: c.h * v.h }; };
  const toCrop = (b) => { const v = view(); return { x: (b.cx - b.w / 2) / v.w, y: (b.cy - b.h / 2) / v.h, w: b.w / v.w, h: b.h / v.h }; };
  const turnAbout = (b, a) => { const v = view(), dx = b.cx - v.w / 2, dy = b.cy - v.h / 2, c = Math.cos(a), s = Math.sin(a); return { cx: v.w / 2 + dx * c - dy * s, cy: v.h / 2 + dx * s + dy * c, w: b.w, h: b.h }; };
  const onScreen = (b) => turnAbout(b, -rad());   // where a box shows on Compose's upright frame
  const fromScreen = (b) => turnAbout(b, rad());
  function fits(b) {
    const v = view(), a = rad(), c = Math.cos(a), s = Math.sin(a), e = 1e-6;
    if (!(b.w >= 1 && b.h >= 1)) return false;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => { const x = (sx * b.w) / 2, y = (sy * b.h) / 2, px = b.cx + x * c - y * s, py = b.cy + x * s + y * c; return px >= -e && py >= -e && px <= v.w + e && py <= v.h + e; });
  }
  // The largest box of shape `ratio` (width over height) about a centre that lies on the picture.
  function largestAt(cx, cy, ratio) {
    const v = view(), big = Math.hypot(v.w, v.h);
    let lo = 0, hi = 1;
    const at = (t) => ({ cx, cy, w: (ratio >= 1 ? big : big * ratio) * t, h: (ratio >= 1 ? big / ratio : big) * t });
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fits(at(m))) lo = m; else hi = m; }
    return at(lo);
  }
  function largest(ratio, near) {
    const v = view(), mid = largestAt(v.w / 2, v.h / 2, ratio);
    if (!near) return mid;
    const there = largestAt(near.cx, near.cy, ratio);
    return there.w * there.h >= mid.w * mid.h * 0.6 ? there : mid;
  }
  // As far from `from` toward `to` as the picture allows.
  function toward(from, to) {
    if (fits(to)) return to;
    const lerp = (t) => ({ cx: from.cx + (to.cx - from.cx) * t, cy: from.cy + (to.cy - from.cy) * t, w: from.w + (to.w - from.w) * t, h: from.h + (to.h - from.h) * t });
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fits(lerp(m))) lo = m; else hi = m; }
    return lerp(lo);
  }
  const ratio = () => (state.plan.canvas_w > 0 && state.plan.canvas_h > 0 ? state.plan.canvas_w / state.plan.canvas_h : 0.8);
  const isLargest = (b) => fits(b) && !fits({ ...b, w: b.w * 1.02, h: b.h * 1.02 });
  // A free crop: the canvas keeps its long side and takes the crop's shape.
  function canvasFollows(b) {
    if (!state.recipe.freeCrop) return;
    const long = Math.max(state.plan.canvas_w, state.plan.canvas_h), q = b.w / b.h;
    ctx.setCanvas(q >= 1 ? long : round1(long * q), q >= 1 ? round1(long / q) : long);
  }
  let live = null; // the panel's size fields and hint, kept in step without rebuilding the panel
  function syncLive() {
    if (!live || !live.wIn.isConnected) return;
    live.wIn.value = String(state.plan.canvas_w); live.hIn.value = String(state.plan.canvas_h);
    live.hint.textContent = hintText();
  }
  const hintText = () => (state.recipe.freeCrop ? 'Drag a corner or an edge. The canvas takes the crop’s shape.' : 'Drag the frame to move it, a corner to resize.');
  function setCrop(b, record, keep) { state.recipe.crop = toCrop(b); canvasFollows(b); syncLive(); if (record) ctx.afterRecipeChange(true, keep); else ctx.requestRender(); }
  // A new canvas shape: the largest crop of it about where the crop was.
  function refit(keep) { const b = toPx(state.recipe.crop); setCrop(largest(ratio(), b), true, keep); }
  function setCanvasShape(w, h, keep) { state.recipe.freeCrop = false; ctx.setCanvas(w, h); refit(keep); }

  // ── the frame on the picture: drag it, a corner sizes it ──
  let drag = null;
  const press = ui.onDragPress(ctx.cropBox, (e) => {
    if (state.tool !== 'compose' || !state.recipe) return;
    e.preventDefault();
    const fr = ctx.frame.getBoundingClientRect(), v = view();
    drag = { corner: (e.target && e.target.dataset && e.target.dataset.corner) || null, x0: e.clientX, y0: e.clientY, b0: onScreen(toPx(state.recipe.crop)), kx: (v.w / Math.max(1, fr.width)) * (state.mirror ? -1 : 1), ky: v.h / Math.max(1, fr.height) };
    try { ctx.cropBox.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
  }, { pointerEvents: true });
  disposers.push(() => press.dispose());
  function dragTo(d, dx, dy) {
    const b = d.b0, v = view(), min = 0.02 * Math.min(v.w, v.h);
    let next;
    if (!d.corner) next = { cx: b.cx + dx, cy: b.cy + dy, w: b.w, h: b.h };
    else {
      // A corner moves two sides, an edge (Free only) one; the sides opposite stay where they are.
      const sx = d.corner.includes('e') ? 1 : d.corner.includes('w') ? -1 : 0, sy = d.corner.includes('s') ? 1 : d.corner.includes('n') ? -1 : 0;
      const ax = b.cx - (sx * b.w) / 2, ay = b.cy - (sy * b.h) / 2;
      let w = sx ? Math.max(min, sx * (b.cx + (sx * b.w) / 2 + dx - ax)) : b.w, h = sy ? Math.max(min, sy * (b.cy + (sy * b.h) / 2 + dy - ay)) : b.h;
      if (!state.recipe.freeCrop) { const q = ratio(); if (!sy || (sx && w / q > h)) h = w / q; else w = h * q; }
      next = { cx: sx ? ax + (sx * w) / 2 : b.cx, cy: sy ? ay + (sy * h) / 2 : b.cy, w, h };
    }
    return toward(fromScreen(b), fromScreen(next));
  }
  const onMove = (e) => { if (!drag) return; setCrop(dragTo(drag, (e.clientX - drag.x0) * drag.kx, (e.clientY - drag.y0) * drag.ky), false); };
  const onUp = () => { if (!drag) return; drag = null; ctx.afterRecipeChange(true); };
  ctx.cropBox.addEventListener('pointermove', onMove); ctx.cropBox.addEventListener('pointerup', onUp); ctx.cropBox.addEventListener('pointercancel', onUp);
  disposers.push(() => { ctx.cropBox.removeEventListener('pointermove', onMove); ctx.cropBox.removeEventListener('pointerup', onUp); ctx.cropBox.removeEventListener('pointercancel', onUp); });
  // The keyboard's drag: arrows move the frame, Alt+arrows size it, in 1% steps.
  disposers.push(moBoxKeys(ctx.cropBox, 'Crop', {
    nudge: (dx, dy, size) => {
      const v = view(), d = { b0: onScreen(toPx(state.recipe.crop)), corner: size ? 'se' : null };
      setCrop(dragTo(d, (dx * v.w) / 100, (dy * v.h) / 100), false);
    },
    commit: () => ctx.afterRecipeChange(true),
  }));

  // ── drawing, after each draw ──
  /** Compose shows the whole picture: dim what the crop leaves out, the guide inside it. */
  function drawOverlay(g, W, H, k) {
    const v = view(), b = onScreen(toPx(state.recipe.crop));
    const x = ((b.cx - b.w / 2) / v.w) * W, y = ((b.cy - b.h / 2) / v.h) * H, w = (b.w / v.w) * W, h = (b.h / v.h) * H;
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.body), tok = (n, f) => css.getPropertyValue(n).trim() || f;
    g.fillStyle = tok('--px-viewer-scrim', 'black');
    g.globalAlpha = 0.75; // the scrim at about 70%: what the crop leaves out stays readable
    g.fillRect(0, 0, W, y); g.fillRect(0, y + h, W, H - y - h); g.fillRect(0, y, x, h); g.fillRect(x + w, y, W - x - w, h);
    g.globalAlpha = 1;
    moPlanDrawGuide(g, x, y, w, h, state.recipe.overlays.guide, state.recipe.overlays.spiral, k, { line: tok('--px-accent', 'dodgerblue'), edge: tok('--px-viewer-bar', 'black') });
  }
  function placeBox(cssW, cssH) {
    const v = view(), b = onScreen(toPx(state.recipe.crop)), s = ctx.cropBox.style;
    s.left = `${((b.cx - b.w / 2) / v.w) * cssW}px`; s.top = `${((b.cy - b.h / 2) / v.h) * cssH}px`;
    s.width = `${(b.w / v.w) * cssW}px`; s.height = `${(b.h / v.h) * cssH}px`;
    ctx.cropBox.classList.toggle('is-free', !!state.recipe.freeCrop); // edges size a free crop
  }

  // ── the panel ──
  function proportion() {
    const r = state.recipe;
    if (r.freeCrop) return 'free';
    const q = ratio(), v = view(), near = (a) => Math.abs(q - a) < 0.012 || Math.abs(q - 1 / a) < 0.012;
    if (near(v.w / v.h) && !(r.angle)) return 'photo';
    for (const [id] of PROPORTIONS.slice(2)) { const [a, b] = id.split(':').map(Number); if (near(a / b)) return id; }
    return '';
  }
  function setProportion(id) {
    const r = state.recipe, long = Math.max(state.plan.canvas_w, state.plan.canvas_h), land = state.plan.canvas_w >= state.plan.canvas_h;
    if (id === 'free') { r.freeCrop = true; canvasFollows(toPx(r.crop)); syncLive(); ctx.afterRecipeChange(true, true); return; }
    let q;
    if (id === 'photo') { const v = view(); q = v.w / v.h; setCanvasShape(q >= 1 ? long : round1(long * q), q >= 1 ? round1(long / q) : long, true); if (!(r.angle)) { r.crop = { x: 0, y: 0, w: 1, h: 1 }; ctx.afterRecipeChange(true, true); } return; }
    const [a, b] = id.split(':').map(Number);
    q = land ? a / b : b / a;
    setCanvasShape(q >= 1 ? long : round1(long * q), q >= 1 ? round1(long / q) : long, true);
  }
  function panel(container, panelDisposers) {
    const r = state.recipe;
    const s1 = moPlanSection(container, 'Canvas');
    const row = moEl('div', 'mo-plan-row mo-pk-size');
    const num = (id, label, value) => { const i = moEl('input', 'mo-clip-input mo-clip-input--xs', { sceneId: id, type: 'number', min: '1', max: '120', step: '0.5', 'aria-label': label }); i.value = String(value); return i; };
    const wIn = num('media-organizer.plan.canvasWidth', 'Canvas Width', state.plan.canvas_w), hIn = num('media-organizer.plan.canvasHeight', 'Canvas Height', state.plan.canvas_h);
    const apply = () => { const w = Math.max(1, Number(wIn.value) || 1), h = Math.max(1, Number(hIn.value) || 1); setCanvasShape(w, h); };
    wIn.addEventListener('change', apply); hIn.addEventListener('change', apply);
    row.append(wIn, moEl('span', 'mo-practice-dim', { textContent: '×' }), hIn, moEl('span', 'mo-practice-dim', { textContent: 'in' }));
    ui.createIconButton(row, { id: 'media-organizer.plan.composeSwapCanvas', icon: 'arrow-left-right', title: 'Swap Width And Height', size: 'sm', command: 'media-organizer.plan.composeSwapCanvas' });
    s1.appendChild(row);
    const presets = ctx.moDropdown({ items: [{ value: '', label: 'Canvas Sizes' }, ...ctx.presets.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} × ${h} in` }))], selected: '', ariaLabel: 'Canvas Sizes' });
    presets.onChange = (v) => { if (!v) return; const [a, b] = v.split('x').map(Number), land = state.plan.canvas_w >= state.plan.canvas_h; setCanvasShape(land ? Math.max(a, b) : Math.min(a, b), land ? Math.min(a, b) : Math.max(a, b)); };
    panelDisposers.push(() => presets.dispose());
    s1.appendChild(presets.el);
    moPlanChoice(ui, s1, { id: 'media-organizer.plan.proportions', label: 'Proportions', items: PROPORTIONS, value: proportion(), onChange: (v) => setProportion(v) }, panelDisposers);
    live = { wIn, hIn, hint: moPlanHint(s1, hintText()) };

    const s2 = moPlanSection(container, 'Straighten', true);
    moPlanSlider(s2, { id: 'media-organizer.plan.straighten', label: 'Angle', min: -45, max: 45, step: 0.1, value: Number(r.angle) || 0, rest: 0, text: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`,
      onInput: (v) => straighten(v, false), onChange: (v) => straighten(v, true, true) });
    const turns = moEl('div', 'mo-plan-row mo-pk-icons', { role: 'group', 'aria-label': 'Turn and flip' });
    for (const [a, icon, title] of [['composeRotateLeft', 'rotate-ccw', 'Rotate Left'], ['composeRotateRight', 'rotate-cw', 'Rotate Right'], ['composeFlipH', 'flip-horizontal-2', 'Flip Horizontal'], ['composeFlipV', 'flip-vertical-2', 'Flip Vertical'], ['composeResetCrop', 'scan', 'Reset Crop: the largest frame, centred']]) ui.createIconButton(turns, { id: `media-organizer.plan.${a}`, icon, title, size: 'sm', command: `media-organizer.plan.${a}` });
    s2.appendChild(turns);

    const s3 = moPlanSection(container, 'Composition guide', true);
    const grid = moEl('div', 'mo-pk-guides', { role: 'group', 'aria-label': 'Composition guide' });
    for (const [id, label, svg] of MO_PLAN_GUIDES) {
      const b = ui.createButton(grid, { id: `media-organizer.plan.guide.${id}`, label, kind: 'ghost', size: 'sm', command: 'media-organizer.plan.composeGuide', args: [id] });
      b.classList.add('mo-pk-guide'); b.setAttribute('aria-pressed', String(r.overlays.guide === id));
      b.prepend(moEl('span', 'mo-pk-guide-art', { 'aria-hidden': 'true', innerHTML: `<svg viewBox="0 0 34 24">${svg}</svg>` }));
    }
    s3.appendChild(grid);
    if (r.overlays.guide === 'spiral' || r.overlays.guide === 'triangles') ui.createButton(s3, { id: 'media-organizer.plan.composeTurnGuide', label: 'Turn The Guide', icon: 'refresh-cw', size: 'sm', command: 'media-organizer.plan.composeTurnGuide', title: 'Move the guide’s eye to the next corner' });
    moPlanHint(s3, 'Line up the strong shapes with the guide.');
  }
  // ── Transfer: the grid in inches, over the view the painter studied last ──
  function transferPanel(container, panelDisposers) {
    const o = state.recipe.overlays;
    const s = moPlanSection(container, 'Grid');
    moPlanChoice(ui, s, { id: 'media-organizer.plan.gridInches', label: 'Squares', items: [['0.5', '½ in'], ['1', '1 in'], ['2', '2 in'], ['3', '3 in']], value: String(o.gridInches || 1), onChange: (v) => { o.gridInches = Number(v) || 1; ctx.afterRecipeChange(true, true); } }, panelDisposers);
    moPlanSwitch(ui, s, { id: 'media-organizer.plan.gridLabels', label: 'Number the squares', checked: o.gridLabels !== false, onChange: (on) => { o.gridLabels = on; ctx.afterRecipeChange(true, true); } }, panelDisposers);
    moPlanHint(s, `For a ${state.plan.canvas_w} × ${state.plan.canvas_h} in canvas: rule the same grid and copy square by square.`);
    const s2 = moPlanSection(container, 'Under the grid', true);
    moPlanChoice(ui, s2, { id: 'media-organizer.plan.transferShows', ariaLabel: 'Under the grid', items: [['photo', 'Photo'], ['values', 'Values'], ['colour', 'Colour']], value: state.view || 'photo', onChange: (v) => ctx.setView(v) }, panelDisposers);
    moPlanHint(s2, 'What Export and Print show.');
    const row = moEl('div', 'mo-plan-row');
    ui.createButton(row, { id: 'media-organizer.plan.exportWithGrid', label: 'Export With Grid', kind: 'primary', size: 'sm', command: 'media-organizer.plan.exportWithGrid' });
    ui.createButton(row, { id: 'media-organizer.plan.printWithGrid', label: 'Print With Grid…', size: 'sm', command: 'media-organizer.plan.printWithGrid' });
    s2.appendChild(row);
  }
  function straighten(v, record, keep) {
    const r = state.recipe, before = toPx(r.crop), wasLargest = isLargest(before);
    r.angle = Math.max(-45, Math.min(45, v));
    let b = before;
    if (wasLargest) b = largest(r.freeCrop ? before.w / before.h : ratio(), before);
    else if (!fits(b)) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits({ ...b, w: b.w * m, h: b.h * m })) lo = m; else hi = m; } b = { ...b, w: b.w * lo, h: b.h * lo }; }
    setCrop(b, record, keep);
  }

  // ── what each command does on this plan ──
  function turn(q) {
    const r = state.recipe, whole = r.crop.w > 0.999 && r.crop.h > 0.999 && !(r.angle);
    r.rotate = (r.rotate + q) % 4;
    if (whole) { ctx.setCanvas(state.plan.canvas_h, state.plan.canvas_w); r.crop = { x: 0, y: 0, w: 1, h: 1 }; ctx.afterRecipeChange(true); }
    else setCrop(largest(r.freeCrop ? toPx(r.crop).w / toPx(r.crop).h : ratio()), true);
  }
  const acts = {
    composeRotateLeft: () => turn(3), composeRotateRight: () => turn(1),
    composeFlipH: () => { state.recipe.flipH = !state.recipe.flipH; ctx.afterRecipeChange(true); },
    composeFlipV: () => { state.recipe.flipV = !state.recipe.flipV; ctx.afterRecipeChange(true); },
    composeResetCrop: () => { const b = toPx(state.recipe.crop); setCrop(largest(state.recipe.freeCrop ? b.w / b.h : ratio()), true); },
    composeSwapCanvas: () => { state.recipe.freeCrop = false; ctx.setCanvas(state.plan.canvas_h, state.plan.canvas_w); refit(); },
    composeGuide: (id) => { if (!MO_PLAN_GUIDES.some((g) => g[0] === id)) return; state.recipe.overlays.guide = id; ctx.afterRecipeChange(true); },
    composeTurnGuide: () => { const o = state.recipe.overlays; o.spiral = ((o.spiral || 0) + 1) % 4; ctx.afterRecipeChange(true, true); },
  };
  const handle = { root: ctx.root, act: (name, ...args) => (acts[name] && state.recipe ? acts[name](...args) : undefined) };
  open.add(handle);
  const used = () => { lastUsed = handle; };
  ctx.root.addEventListener('focusin', used);

  return {
    panel,
    transferPanel,
    drawOverlay,
    placeBox,
    dispose() {
      open.delete(handle); if (lastUsed === handle) lastUsed = null;
      ctx.root.removeEventListener('focusin', used);
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
    },
  };
}
