// plan-shell.js — the painting plan editor's frame: the five steps down the
// rail in the order a painter works (Compose, Photo, Values, Colour,
// Transfer), the top bar (Undo, Redo, Before And After, Mirror, Notes, Board,
// Export) and the view of the picture. The view zooms with the scroll wheel
// about the pointer, moves with a drag, fits again with a double-click or Fit;
// from the keyboard + and - zoom, 0 fits and the arrows move; a finger pinches
// and drags. A drag on the picture moves it unless the step uses the press
// (the crop frame, the picker): the middle button, or Space held, always moves.
// main.js's plan editor hands in its state and actions (moPlanShell).

import { moEl } from './dom.js';
import { moViewKeys } from './keys.js';

export const MO_PLAN_STEPS = [
  ['compose', 'Compose', 'crop', 'Canvas size, the crop and composition guides'],
  ['photo', 'Photo', 'sliders-horizontal', 'Enhance and edit the picture'],
  ['values', 'Values', 'contrast', 'Squint, values and the underpainting colour'],
  ['colour', 'Colour', 'palette', 'Colour masses, the palette and how to mix it'],
  ['transfer', 'Transfer', 'grid-3x3', 'The grid for drawing it up on the canvas'],
];
const MIN_ZOOM = 0.25, MAX_ZOOM = 16;
const ACTIONS = ['goStep', 'undo', 'redo', 'toggleBeforeAfter', 'toggleMirror', 'toggleNotes', 'openPlanBoard', 'exportPlan', 'exportWithGrid', 'printWithGrid', 'exportMenu', 'fitView', 'zoomIn', 'zoomOut'];

const open = new Set();
let lastUsed = null;
const inUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanShellActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = inUse(); return p ? p.act(a, ...args) : undefined; }));
}

/**
 * ctx: { api, root, state, rail, topbar, titleEl, sizeEl, stage, frame,
 *   act: { setStep(id), undo(), redo(), toggleSplit(), toggleMirror(), toggleNotes(),
 *          openBoard(), exportPlan(withGrid), printPlan() },
 *   pressUsed(e) -> true when the step takes this press on the picture itself,
 *   onZoom() redraws at the new zoom }.
 * The editor calls sync() after each change and applyView() after each draw.
 */
export function moPlanShell(ctx) {
  const { api, state, stage, frame } = ctx;
  const ui = api.ui;
  const view = { z: 1, x: 0, y: 0 };
  const disposers = [];

  // ── the rail ──
  const stepBtns = {};
  MO_PLAN_STEPS.forEach(([id, label, icon, note], k) => {
    const b = ui.createButton(ctx.rail, { id: `media-organizer.plan.step.${id}`, label, icon, kind: 'ghost', title: note, command: 'media-organizer.plan.goStep', args: [id] });
    b.classList.add('mo-plan-step');
    b.setAttribute('aria-label', label);
    b.prepend(moEl('span', 'mo-plan-step-n', { textContent: String(k + 1), 'aria-hidden': 'true' }));
    stepBtns[id] = b;
  });

  // ── the top bar ──
  const left = moEl('div', 'mo-plan-topbar-left');
  left.append(ctx.titleEl, ctx.sizeEl);
  const right = moEl('div', 'mo-plan-topbar-right');
  const icon = (action, iconId, title) => ui.createIconButton(right, { id: `media-organizer.plan.${action}`, icon: iconId, title, size: 'sm', command: `media-organizer.plan.${action}` });
  const sep = () => right.appendChild(moEl('span', 'mo-plan-sep', { 'aria-hidden': 'true' }));
  const undoBtn = icon('undo', 'undo-2', 'Undo (Ctrl+Z)');
  const redoBtn = icon('redo', 'redo-2', 'Redo (Ctrl+Y)');
  sep();
  const baBtn = icon('toggleBeforeAfter', 'columns-2', 'Before And After: the photo left of a line you drag on the picture');
  const mirrorBtn = icon('toggleMirror', 'flip-horizontal-2', 'Mirror: see the picture with fresh eyes. The plan itself is not flipped.');
  const notesBtn = icon('toggleNotes', 'notebook-pen', 'Notes And Process Photos');
  icon('openPlanBoard', 'layout-dashboard', 'Open Board');
  sep();
  const exportGroup = moEl('div', 'mo-plan-export');
  const exportBtn = ui.createButton(exportGroup, { id: 'media-organizer.plan.exportPlan', label: 'Export', kind: 'primary', size: 'sm', title: 'Write the plan beside the original photo', command: 'media-organizer.plan.exportPlan' });
  const moreBtn = ui.createIconButton(exportGroup, { id: 'media-organizer.plan.exportMenu', icon: 'chevron-down', title: 'More Ways To Export', size: 'sm', command: 'media-organizer.plan.exportMenu' });
  moreBtn.classList.add('mo-plan-export-more');
  moreBtn.setAttribute('aria-haspopup', 'menu');
  right.appendChild(exportGroup);
  for (const b of [baBtn, mirrorBtn, notesBtn]) b.setAttribute('aria-pressed', 'false');
  ctx.topbar.append(left, right);

  // ── the view ──
  const hud = moEl('div', 'mo-plan-hud');
  const zoomText = moEl('span', 'mo-plan-hud-zoom', { 'aria-hidden': 'true' });
  hud.appendChild(zoomText);
  ui.createButton(hud, { id: 'media-organizer.plan.fitView', label: 'Fit', kind: 'ghost', size: 'sm', title: 'Fit the picture (double-click, or 0)', command: 'media-organizer.plan.fitView' });
  stage.appendChild(hud);

  function clampPan() {
    const fw = frame.offsetWidth * view.z, fh = frame.offsetHeight * view.z, sw = stage.clientWidth, sh = stage.clientHeight;
    const mx = Math.max(0, (fw + sw) / 2 - 48), my = Math.max(0, (fh + sh) / 2 - 48);
    view.x = Math.max(-mx, Math.min(mx, view.x)); view.y = Math.max(-my, Math.min(my, view.y));
  }
  function applyView() {
    clampPan();
    frame.style.transform = `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.z})${state.mirror ? ' scaleX(-1)' : ''}`;
    frame.style.setProperty('--mo-plan-zoom', String(view.z));
    zoomText.textContent = `${Math.round(view.z * 100)}%`;
    stage.classList.toggle('is-zoomed', view.z > 1.001);
  }
  let zoomTimer = 0;
  function zoomAt(clientX, clientY, factor) {
    const r = stage.getBoundingClientRect();
    const cx = clientX - r.left - r.width / 2, cy = clientY - r.top - r.height / 2;
    const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.z * factor));
    view.x = cx - ((cx - view.x) * z1) / view.z; view.y = cy - ((cy - view.y) * z1) / view.z; view.z = z1;
    applyView();
    clearTimeout(zoomTimer); zoomTimer = setTimeout(() => ctx.onZoom(), 120); // sharpen once the wheel rests
  }
  const zoomBy = (f) => { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); };
  function fit() { view.z = 1; view.x = 0; view.y = 0; applyView(); ctx.onZoom(); }

  const onWheel = (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))); };
  stage.addEventListener('wheel', onWheel, { passive: false });
  disposers.push(() => stage.removeEventListener('wheel', onWheel));
  const onDbl = (e) => { if (!e.target.closest('.mo-plan-hud, .mo-pc-ba-line, .mo-plan-cropbox')) fit(); };
  stage.addEventListener('dblclick', onDbl);
  disposers.push(() => stage.removeEventListener('dblclick', onDbl));
  disposers.push(moViewKeys(stage, 'Picture. Plus and minus zoom, 0 fits, the arrow keys move a zoomed picture.', { zoom: () => view.z, zoomBy, pan: (dx, dy) => { view.x += dx; view.y += dy; applyView(); }, reset: fit }));

  // Space held: a drag anywhere moves the picture.
  let space = false;
  const onKey = (e) => {
    if (e.key !== ' ' || (e.target && /^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName))) return;
    if (e.type === 'keydown' && !e.repeat && e.target === stage) { space = true; stage.classList.add('is-panning'); }
    if (e.type === 'keyup') { space = false; stage.classList.remove('is-panning'); }
  };
  ctx.root.addEventListener('keydown', onKey); ctx.root.addEventListener('keyup', onKey);
  disposers.push(() => { ctx.root.removeEventListener('keydown', onKey); ctx.root.removeEventListener('keyup', onKey); });

  // A drag moves the picture; two fingers pinch.
  const touches = new Map();
  let pan = null, pinch = null;
  const press = ui.onDragPress(stage, (e) => {
    if (e.target.closest('.mo-plan-hud') || pinch) return;
    const free = e.button === 1 || space || e.target === stage;
    if (!free && ctx.pressUsed(e)) return;
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
  }, { pointerEvents: true });
  disposers.push(() => press.dispose());
  // Every finger is counted here (the press above hears only the first): two make a pinch.
  const onFinger = (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2) return;
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: view.z };
    pan = null;
  };
  stage.addEventListener('pointerdown', onFinger, true);
  disposers.push(() => stage.removeEventListener('pointerdown', onFinger, true));
  const onMove = (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d / view.z);
      return;
    }
    if (!pan || pan.id !== e.pointerId) return;
    view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y;
    stage.classList.add('is-panning');
    applyView();
  };
  const onUp = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (pan && pan.id === e.pointerId) { pan = null; if (!space) stage.classList.remove('is-panning'); }
  };
  stage.addEventListener('pointermove', onMove); stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  disposers.push(() => { stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp); });

  function sync(canUndo, canRedo) {
    for (const [id, b] of Object.entries(stepBtns)) { const on = state.tool === id && !state.notes; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    undoBtn.disabled = !canUndo; redoBtn.disabled = !canRedo;
    baBtn.setAttribute('aria-pressed', String(state.split >= 0));
    baBtn.disabled = state.tool === 'compose';
    mirrorBtn.setAttribute('aria-pressed', String(state.mirror));
    notesBtn.setAttribute('aria-pressed', String(!!state.notes));
  }
  const a = ctx.act;
  const acts = {
    goStep: (id) => { if (MO_PLAN_STEPS.some((s) => s[0] === id)) a.setStep(id); },
    undo: () => a.undo(), redo: () => a.redo(),
    toggleBeforeAfter: () => a.toggleSplit(), toggleMirror: () => a.toggleMirror(), toggleNotes: () => a.toggleNotes(),
    openPlanBoard: () => a.openBoard(),
    exportPlan: () => a.exportPlan(false), exportWithGrid: () => a.exportPlan(true), printWithGrid: () => a.printPlan(),
    exportMenu: () => ui.createMenu(moreBtn, { id: 'media-organizer.plan.exportChoices', label: 'More Ways To Export', items: [
      { label: 'Export Plan', icon: 'image-up', onSelect: () => a.exportPlan(false) },
      { label: 'Export With Grid', icon: 'grid-3x3', onSelect: () => a.exportPlan(true) },
      { label: 'Print With Grid…', icon: 'printer', onSelect: () => a.printPlan() },
    ] }),
    fitView: () => fit(), zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8),
  };
  const handle = { root: ctx.root, act: (name, ...args) => (acts[name] ? acts[name](...args) : undefined) };
  open.add(handle);
  const used = () => { lastUsed = handle; };
  ctx.root.addEventListener('focusin', used);
  lastUsed = handle;

  return {
    view,
    sync,
    applyView,
    fit,
    panBy(dx, dy) { view.x += dx; view.y += dy; applyView(); },
    setExporting(on) { exportBtn.disabled = on; moreBtn.disabled = on; },
    dispose() {
      open.delete(handle); if (lastUsed === handle) lastUsed = null;
      ctx.root.removeEventListener('focusin', used);
      clearTimeout(zoomTimer);
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
    },
  };
}
