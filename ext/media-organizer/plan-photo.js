// plan-photo.js — the plan's second step: the picture made ready to study.
// Enhance runs on the crop (SeedVR2, enhance-engine.js), and from then on
// every step works from the enhanced copy; a crop, turn or removal made after
// it leaves the copy out of date until Enhance Again. Below it are the Image
// Editor's own sections (moEditPanelKit in main.js: Light, Tone Curve, Colour,
// Colour Mixer, Colour Grading, Effects, Detail), on the plan's recipe, and
// Remove, which brushes a mark out with the editor's fill.
//
// The plan's files (removal patches, enhanced copies) live in its own folder
// in the workspace, apart from the editor's, so neither's clean-up touches the
// other's. Removals sit in the photo's own pixels; the picture a step draws
// from is the photo with them laid over it, or the enhanced copy.

import { moEl } from './dom.js';
import { moPlanHint, moPlanSection, moPlanSlider } from './plan-kit.js';

const ACTIONS = ['photoEnhance', 'photoStopEnhance', 'photoUseOriginal', 'photoRemoveMode', 'photoClearRemovals', 'photoOpenEditor', 'photoSetUpEnhance'];
const IDENT = { crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false };

const open = new Set();
let lastUsed = null;
const inUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanPhotoActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = inUse(); return p ? p.act(a, ...args) : undefined; }));
}

/** What an enhanced copy was made from: when any of it changes, the copy is out of date. */
export function moPlanEnhanceKey(r) {
  return JSON.stringify({ c: r.crop, a: Number(r.angle) || 0, t: r.rotate, h: !!r.flipH, v: !!r.flipV, m: (r.removals || []).map((m) => m.file) });
}

/**
 * ctx: { api, state, root, frame, planId, afterRecipeChange(record, keep), requestRender(), renderPanel(),
 *   sourceChanged(), editedPixels(max, rest) -> { px, w, h }, toSource(u, v) -> [x, y] in the photo's pixels,
 *   sourceScale() -> photo pixels per screen pixel, renderCrop() -> PNG bytes of the crop (no look),
 *   deps: { panelKit, histogram, autoTone, whiteBalance, enhance: { ready, card, run, stop, temp },
 *     removal: { state, fill }, files: { dir, read, write, dispose, list } } }.
 */
export function moPlanPhoto(ctx) {
  const { api, state, deps } = ctx;
  const ui = api.ui;
  const sep = () => (String(deps.files.dir() || '').includes('\\') ? '\\' : '/');
  const pathOf = (file) => { const d = deps.files.dir(); return d && /^[\w.-]+\.png$/.test(file) ? d + sep() + file : null; };
  let work = null, workKey = '[]';   // the photo with the plan's removals laid over it
  let enh = null;                    // { file, img }: the enhanced copy, decoded
  let job = null;                    // a running Enhance: { runId, label, fraction }
  let engine = null;                 // Enhance set up: null (not asked), true, false
  let enhanceCard = false; // Enhance's setup card, shown once asked for
  let remover = 'unknown';           // the Remove model: 'unknown' | 'ready' | other
  let removing = false;              // the picture takes brush strokes
  let brush = 40;
  const disposers = [];

  // ── where each step draws from ──
  const valid = () => { const e = state.recipe && state.recipe.enhanced; return !!e && e.key === moPlanEnhanceKey(state.recipe); };
  /** The picture a step draws from, and the recipe to draw it with. */
  function source(step) {
    const base = work || state.deep || state.image; // the photo at full depth when the editor read it (a raw)
    if (step !== 'compose' && valid() && enh && enh.file === state.recipe.enhanced.file) return { img: enh.img, eff: (r) => Object.assign({}, r, IDENT), enhanced: true };
    return { img: base, eff: (r) => r, enhanced: false };
  }
  async function decode(path) {
    const bytes = await deps.files.read(path);
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  }
  let refreshing = null;
  /** Brings the removals and the enhanced copy in line with the recipe; the editor redraws when they change. */
  function refresh() {
    if (refreshing) { refreshing.again = true; return; }
    refreshing = { again: false };
    void (async () => {
      let changed = false;
      try {
        const r = state.recipe;
        if (!r || !state.image) return;
        const list = (r.removals || []).filter((m) => m && !m.hidden), key = JSON.stringify(list.map((m) => m.file));
        if (key !== workKey) {
          let cv = null;
          if (list.length) {
            cv = moEl('canvas'); cv.width = state.imgW; cv.height = state.imgH;
            const g = cv.getContext('2d'); g.drawImage(state.image, 0, 0);
            for (const m of list) { const p = pathOf(m.file); if (!p) continue; try { const patch = await decode(p); g.drawImage(patch, m.x, m.y, m.w, m.h); patch.close(); } catch { /* a missing patch is left out */ } }
          }
          work = cv; workKey = key; changed = true;
        }
        const e = r.enhanced;
        if (e && e.file && (!enh || enh.file !== e.file)) {
          const p = pathOf(e.file);
          try { enh = p ? { file: e.file, img: await decode(p) } : null; } catch { enh = null; }
          changed = true;
        }
      } finally {
        const again = refreshing.again; refreshing = null;
        if (changed) ctx.sourceChanged();
        if (again) refresh();
      }
    })();
  }

  // ── Enhance ──
  async function enhance(scale) {
    if (job || !state.recipe) return;
    const r = state.recipe, key = moPlanEnhanceKey(r), dir = deps.files.dir();
    if (!dir) { api.window.showErrorMessage('Enhance needs an open workspace to keep the enhanced copy in.'); return; }
    job = { runId: null, label: 'Getting the crop ready', fraction: null };
    ctx.renderPanel();
    try {
      const file = `enh-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`;
      await deps.enhance.temp(async (tmp) => {
        const input = tmp + sep() + 'crop.png', output = tmp + sep() + 'out.png';
        await deps.files.write(input, await ctx.renderCrop());
        await deps.enhance.run(input, output, scale, (p) => { if (!job) return; job.label = p.label || 'Enhancing'; job.fraction = typeof p.fraction === 'number' ? p.fraction : null; syncJob(); }, { workDir: tmp, onRunId: (id) => { if (job) job.runId = id; } });
        await deps.files.write(dir + sep() + file, await deps.files.read(output));
      });
      if (!state.recipe || moPlanEnhanceKey(state.recipe) !== key) { await deps.files.dispose([dir + sep() + file]); return; }
      state.recipe.enhanced = { file, key, scale };
      job = null;
      ctx.afterRecipeChange(true);
      refresh();
    } catch (err) {
      if (job) api.window.showErrorMessage('Enhance did not finish: ' + ((err && err.message) || err));
    } finally { if (job) { job = null; ctx.renderPanel(); } }
  }
  let jobEl = null;
  function syncJob() {
    if (!jobEl || !jobEl.isConnected || !job) return;
    jobEl.querySelector('.mo-pp-job-label').textContent = job.label;
    const bar = jobEl.querySelector('.mo-pp-job-fill');
    bar.style.width = `${Math.round((job.fraction || 0) * 100)}%`;
    jobEl.querySelector('.mo-pp-job-bar').setAttribute('aria-valuenow', String(Math.round((job.fraction || 0) * 100)));
  }

  // ── Remove: brush over a mark on the picture ──
  const paint = moEl('canvas', 'mo-pp-paint mo-hidden', { 'aria-hidden': 'true' });
  const layer = moEl('div', 'mo-pc-layer mo-pp-layer mo-hidden', { role: 'application', 'aria-label': 'Picture. Brush over a mark to remove it; with Alt held, brush to bring a removal back.' });
  ctx.frame.append(paint, layer);
  let stroke = null;
  const local = (e) => { const r = ctx.frame.getBoundingClientRect(); let u = (e.clientX - r.left) / Math.max(1, r.width); if (state.mirror) u = 1 - u; return { u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))) }; };
  function drawStroke() {
    const g = paint.getContext('2d'), dpr = window.devicePixelRatio || 1, W = ctx.frame.clientWidth, H = ctx.frame.clientHeight;
    if (paint.width !== Math.round(W * dpr)) paint.width = Math.round(W * dpr);
    if (paint.height !== Math.round(H * dpr)) paint.height = Math.round(H * dpr);
    g.clearRect(0, 0, paint.width, paint.height);
    if (!stroke) return;
    const css = getComputedStyle(document.body);
    g.strokeStyle = g.fillStyle = (stroke.back ? css.getPropertyValue('--px-info') : css.getPropertyValue('--px-danger')).trim() || 'red';
    g.globalAlpha = 0.45; g.lineCap = 'round'; g.lineJoin = 'round';
    const zoom = Number(getComputedStyle(ctx.frame).getPropertyValue('--mo-plan-zoom')) || 1;
    g.lineWidth = (brush / zoom) * dpr;
    g.beginPath();
    stroke.pts.forEach((p, i) => { const x = p.u * W * dpr, y = p.v * H * dpr; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    if (stroke.pts.length === 1) { g.arc(stroke.pts[0].u * W * dpr, stroke.pts[0].v * H * dpr, g.lineWidth / 2, 0, Math.PI * 2); g.fill(); } else g.stroke();
  }
  const press = ui.onDragPress(layer, (e) => {
    if (!removing || remover !== 'ready' || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    stroke = { pts: [local(e)], back: !!e.altKey };
    try { layer.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
    drawStroke();
  }, { pointerEvents: true });
  disposers.push(() => press.dispose());
  const onMove = (e) => { if (!stroke) return; stroke.pts.push(local(e)); drawStroke(); };
  const onUp = () => { const s = stroke; stroke = null; if (s) void finishStroke(s); };
  layer.addEventListener('pointermove', onMove); layer.addEventListener('pointerup', onUp); layer.addEventListener('pointercancel', () => { stroke = null; drawStroke(); });
  // White balance: one click on something that should be neutral.
  const onPick = (e) => {
    if (!kitState.pickWb || removing) return;
    const p = local(e), got = ctx.editedPixels(512, true);
    if (!got) return;
    const x = Math.round(p.u * (got.w - 1)), y = Math.round(p.v * (got.h - 1)), acc = [0, 0, 0]; let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (Math.min(got.h - 1, Math.max(0, y + dy)) * got.w + Math.min(got.w - 1, Math.max(0, x + dx))) * 4; acc[0] += got.px[i]; acc[1] += got.px[i + 1]; acc[2] += got.px[i + 2]; n++; }
    Object.assign(state.recipe, deps.whiteBalance(acc[0] / n / 255, acc[1] / n / 255, acc[2] / n / 255));
    kitState.pickWb = false;
    ctx.afterRecipeChange(true);
  };
  layer.addEventListener('pointerdown', onPick);
  disposers.push(() => layer.removeEventListener('pointerdown', onPick));

  async function finishStroke(s) {
    const r = state.recipe;
    if (!r) return;
    const ppx = ctx.sourceScale(), radius = Math.max(1, (brush / 2) * ppx);
    const pts = s.pts.map((p) => ctx.toSource(p.u, p.v));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - radius - 2)), y0 = Math.max(0, Math.floor(Math.min(...ys) - radius - 2));
    const x1 = Math.min(state.imgW, Math.ceil(Math.max(...xs) + radius + 2)), y1 = Math.min(state.imgH, Math.ceil(Math.max(...ys) + radius + 2));
    if (x1 <= x0 || y1 <= y0) { drawStroke(); return; }
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (s.back) {
      const hit = (m) => m.x < box.x + box.w && m.x + m.w > box.x && m.y < box.y + box.h && m.y + m.h > box.y;
      const keep = (r.removals || []).filter((m) => !hit(m));
      if (keep.length !== (r.removals || []).length) { r.removals = keep; ctx.afterRecipeChange(true); refresh(); }
      drawStroke(); return;
    }
    job = { runId: null, label: 'Removing', fraction: null }; ctx.renderPanel();
    try {
      const mask = moEl('canvas'); mask.width = box.w; mask.height = box.h;
      const g = mask.getContext('2d');
      g.translate(-box.x, -box.y); g.strokeStyle = g.fillStyle = 'white'; g.lineWidth = radius * 2; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); pts.forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      if (pts.length === 1) { g.arc(pts[0][0], pts[0][1], radius, 0, Math.PI * 2); g.fill(); } else g.stroke();
      const src = work || state.image;
      const { patch } = await deps.removal.fill(src, mask, box);
      const blob = await new Promise((res) => patch.toBlob(res, 'image/png'));
      const file = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`, p = pathOf(file);
      if (!blob || !p) throw new Error('Remove needs an open workspace to keep its patches in.');
      await deps.files.write(p, new Uint8Array(await blob.arrayBuffer()));
      r.removals = (r.removals || []).concat([{ file, ...box }]);
      job = null;
      ctx.afterRecipeChange(true);
      refresh();
    } catch (err) {
      api.window.showErrorMessage('The mark could not be removed: ' + ((err && err.message) || err));
    } finally { stroke = null; drawStroke(); if (job) { job = null; ctx.renderPanel(); } }
  }

  // ── the panel ──
  const kitState = { get recipe() { return state.recipe; }, curveChannel: 'rgb', mixColour: 'red', hist: null, pickWb: false, curveSel: 0, curveDirty: false };
  // A slider let go keeps the panel as it is; its section dots and histogram catch up once the hand rests.
  let slideTimer = 0;
  const afterSlide = (rec) => { ctx.afterRecipeChange(rec, true); clearTimeout(slideTimer); slideTimer = setTimeout(() => { if (state.tool === 'photo' && !ctx.root.querySelector('input[type=range]:active')) ctx.renderPanel(); }, 400); };
  const kit = deps.panelKit({ api, root: ctx.root, state: kitState, afterChange: (rec) => ctx.afterRecipeChange(rec), afterSlide, requestRender: () => ctx.requestRender(), renderPanel: () => ctx.renderPanel(),
    autoTone: () => { const got = ctx.editedPixels(256, true); if (!got) return; Object.assign(state.recipe, deps.autoTone(deps.histogram(got.px))); state.recipe.off = (state.recipe.off || []).filter((x) => x !== 'light'); ctx.afterRecipeChange(true); },
    togglePickWb: () => { kitState.pickWb = !kitState.pickWb; if (kitState.pickWb) removing = false; sync(); ctx.renderPanel(); } });
  // Masks (edit-masks.js) on the plan's recipe, their handles and brush in the frame over the crop.
  const inv = (m) => { const d = m[0] * m[4] - m[1] * m[3] || 1e-12; return [m[4] / d, -m[1] / d, (m[1] * m[5] - m[2] * m[4]) / d, -m[3] / d, m[0] / d, (m[2] * m[3] - m[0] * m[5]) / d]; };
  const app = (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
  const masksTool = ctx.masks({ api, root: ctx.root, kit, host: ctx.frame, recipe: () => state.recipe, requestRender: () => ctx.requestRender(),
    afterChange: (rec) => { if (rec) ctx.afterRecipeChange(true); else { ctx.renderPanel(); ctx.requestRender(); } },
    on: () => state.tool === 'photo' && !state.notes && !removing && !kitState.pickWb, photoSize: () => ({ w: state.imgW, h: state.imgH }),
    toScreen: (u, v) => { const o = app(inv(ctx.geometry().m), u, v); return { x: o[0] * ctx.frame.clientWidth, y: o[1] * ctx.frame.clientHeight }; },
    fromScreen: (x, y) => { const rc = ctx.frame.getBoundingClientRect(); let ou = (x - rc.left) / Math.max(1, rc.width); if (state.mirror) ou = 1 - ou; const q = app(ctx.geometry().m, ou, (y - rc.top) / Math.max(1, rc.height)); return { u: q[0], v: q[1] }; },
    // the frame is scaled by the view's zoom and may be mirrored: the brush works in what the screen shows
    hostPoint: (x, y) => { const rc = ctx.frame.getBoundingClientRect(); let ou = (x - rc.left) / Math.max(1, rc.width); if (state.mirror) ou = 1 - ou; return { x: ou * ctx.frame.clientWidth, y: ((y - rc.top) / Math.max(1, rc.height)) * ctx.frame.clientHeight }; },
    hostScale: () => ctx.frame.getBoundingClientRect().width / Math.max(1, ctx.frame.clientWidth),
    screenPerPhoto: () => ctx.frame.getBoundingClientRect().width / Math.max(1, ctx.geometry().outW) });
  function panel(container, panelDisposers) {
    const r = state.recipe;
    if (engine === null) void deps.enhance.ready().then((ok) => { engine = !!ok; if (state.tool === 'photo') ctx.renderPanel(); });
    const s = moPlanSection(container, 'Enhance');
    if (job) {
      jobEl = moEl('div', 'mo-pp-job', { role: 'status' });
      const bar = moEl('div', 'mo-pp-job-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Progress' });
      bar.appendChild(moEl('div', 'mo-pp-job-fill'));
      jobEl.append(moEl('span', 'mo-pp-job-label', { textContent: job.label }), bar);
      s.appendChild(jobEl); syncJob();
      if (job.label !== 'Removing') ui.createButton(s, { id: 'media-organizer.plan.photoStopEnhance', label: 'Stop', size: 'sm', command: 'media-organizer.plan.photoStopEnhance' });
    } else if (engine === false && !enhanceCard) {
      moPlanHint(s, 'Enlarge the crop for finer detail. Needs a one-time setup.');
      ui.createButton(s, { id: 'media-organizer.plan.photoSetUpEnhance', label: 'Set Up Enhance…', kind: 'secondary', size: 'sm', command: 'media-organizer.plan.photoSetUpEnhance' });
    } else if (engine === false) {
      const card = deps.enhance.card(api, () => { engine = true; if (state.tool === 'photo') ctx.renderPanel(); });
      s.appendChild(card.el); panelDisposers.push(() => card.dispose());
    } else if (r.enhanced && valid()) {
      s.appendChild(moEl('div', 'mo-pp-status', { textContent: `Working from the ${r.enhanced.scale || 2}× enhanced copy of this crop.` }));
      ui.createButton(s, { id: 'media-organizer.plan.photoUseOriginal', label: 'Use The Original Photo', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.photoUseOriginal' });
    } else {
      if (r.enhanced) s.appendChild(moEl('div', 'mo-pp-status is-stale', { textContent: 'The crop or the removals changed since it was enhanced.' }));
      else moPlanHint(s, 'Enlarge the crop for finer detail to study.');
      const row = moEl('div', 'mo-plan-row');
      for (const k of [2, 4]) ui.createButton(row, { id: `media-organizer.plan.photoEnhance.${k}`, label: r.enhanced ? `Enhance Again ${k}×` : `Enhance ${k}×`, kind: k === 2 ? 'primary' : 'secondary', size: 'sm', command: 'media-organizer.plan.photoEnhance', args: [k], disabled: engine !== true });
      s.appendChild(row);
      if (r.enhanced) ui.createButton(s, { id: 'media-organizer.plan.photoUseOriginal', label: 'Use The Original Photo', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.photoUseOriginal' });
    }
    // The editor's sections, on the plan's recipe.
    const sections = moEl('div', 'mo-pp-sections');
    container.appendChild(sections);
    kitState.hist = null;
    const got = ctx.editedPixels(256, false);
    if (got) kitState.hist = deps.histogram(got.px);
    kit.forgetCurve();
    kit.panelEdit(sections);
    masksTool.panel(sections, panelDisposers);
    // Remove
    const s2 = moPlanSection(container, 'Remove', true);
    if (remover === 'unknown') { void deps.removal.state().then((st) => { remover = st; if (state.tool === 'photo') ctx.renderPanel(); }); moPlanHint(s2, 'Checking'); return; }
    if (remover !== 'ready') {
      moPlanHint(s2, 'Set up Remove in the Image Editor first.');
      ui.createButton(s2, { id: 'media-organizer.plan.photoOpenEditor', label: 'Open In Image Editor', size: 'sm', command: 'media-organizer.plan.photoOpenEditor' });
      return;
    }
    const tgl = ui.createButton(s2, { id: 'media-organizer.plan.photoRemoveMode', label: removing ? 'Done Removing' : 'Brush Out Marks', icon: 'eraser', size: 'sm', command: 'media-organizer.plan.photoRemoveMode' });
    tgl.setAttribute('aria-pressed', String(removing));
    if (removing) moPlanSlider(s2, { id: 'media-organizer.plan.photoBrush', label: 'Brush size', min: 6, max: 240, step: 1, value: brush, text: (v) => `${v} px`, onInput: (v) => { brush = v; }, onChange: (v) => { brush = v; } });
    const n = (r.removals || []).length;
    moPlanHint(s2, removing ? 'Brush over a mark. Alt-brush brings one back.' : n ? `${n} mark${n === 1 ? '' : 's'} removed.` : 'Brush out anything you will not paint.');
    if (n) ui.createButton(s2, { id: 'media-organizer.plan.photoClearRemovals', label: 'Bring Them All Back', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.photoClearRemovals' });
  }

  /** After each draw: the brush layer while removing or picking white balance on the Photo step. */
  function sync() {
    const on = state.tool === 'photo' && !!state.recipe && (removing || kitState.pickWb);
    layer.classList.toggle('mo-hidden', !on);
    paint.classList.toggle('mo-hidden', !on);
    layer.classList.toggle('is-picking', !!kitState.pickWb);
    layer.style.cursor = on ? 'crosshair' : '';
    if (on && layer.tabIndex !== 0) layer.tabIndex = 0;
    masksTool.sync();
  }

  const acts = {
    photoEnhance: (k) => void enhance(k === 4 ? 4 : 2),
    photoStopEnhance: () => { const j = job; job = null; if (j && j.runId) void deps.enhance.stop(j.runId); ctx.renderPanel(); },
    photoUseOriginal: () => { state.recipe.enhanced = null; ctx.afterRecipeChange(true); },
    photoRemoveMode: () => { removing = !removing; if (removing) kitState.pickWb = false; sync(); ctx.renderPanel(); },
    photoClearRemovals: () => { state.recipe.removals = []; ctx.afterRecipeChange(true); refresh(); },
    photoSetUpEnhance: () => { enhanceCard = true; ctx.renderPanel(); },
    photoOpenEditor: () => { if (state.plan) void api.commands.executeCommand('media-organizer.editImage', state.plan.photo_id); },
  };
  const handle = { root: ctx.root, act: (name, ...args) => (acts[name] && state.recipe ? acts[name](...args) : undefined) };
  open.add(handle);
  const used = () => { lastUsed = handle; };
  ctx.root.addEventListener('focusin', used);

  return {
    panel, sync, source, refresh,
    tintMask: () => masksTool.tintMask(),
    /** Every file the plan names, for the sweep of its folder. */
    filesOf: (r) => [...((r && r.removals) || []).map((m) => m.file), ...(r && r.enhanced && r.enhanced.file ? [r.enhanced.file] : [])],
    stopRemoving() { removing = false; kitState.pickWb = false; },
    dispose() {
      open.delete(handle); if (lastUsed === handle) lastUsed = null;
      ctx.root.removeEventListener('focusin', used);
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
      clearTimeout(slideTimer);
      masksTool.dispose();
      if (enh && enh.img && enh.img.close) enh.img.close();
      paint.remove(); layer.remove();
    },
  };
}
