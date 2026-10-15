// plan-isolate.js — a painting plan's Ignore Background. With it on, the plan's values and colours come from
// its subject only: Values and Colour show the background flat grey (the renderer's matte), and the masses,
// the palette and light and shadow leave the background out (study-math.js skips what the picture leaves clear).
// The subject is Select Subject's (edit-select.js), or a Subject mask the Photo step already found.
// The recipe keeps `isolate: { on, file }`, file being the subject's mask image.

import { moPlanHint, moPlanSwitch } from './plan-kit.js';
import { moFieldName, moFieldPng, moSelectBytes, moSelectCancel, moSelectSetUp, moSelectState, moSelector } from './edit-select.js';
import { moMaskImagePut } from './edit-masks.js';

const open = new Set();
let lastUsed = null;
const ACTIONS = ['isolateSetUp', 'isolateCancelSetUp'];
const inUse = () => [...open].find((x) => x.root.contains(document.activeElement)) || (lastUsed && lastUsed.root.isConnected ? lastUsed : null);
export function moPlanIsolateActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.plan.${a}`, (...args) => { const p = inUse(); return p ? p.act(a, ...args) : undefined; }));
}
/** A recipe's isolate, checked. */
export const moPlanIsolateNormalize = (o) => ({ on: !!(o && o.on), file: o && /^[0-9a-f]{24}\.png$/.test(String(o.file)) ? String(o.file) : '' });

/** ctx: { api, root, state, select (null when no models can run: no switch), afterRecipeChange(record, keepPanel) }. */
export function moPlanIsolate(ctx) {
  const { api, state } = ctx;
  const ui = api.ui;
  const S = { st: null, download: null, error: '', busy: false, note: '', dlText: null };
  const iso = () => (state.recipe.isolate = moPlanIsolateNormalize(state.recipe.isolate));
  const fromMasks = () => (state.recipe.masks || []).flatMap((m) => (m && m.parts) || []).find((p) => p && p.kind === 'subject' && !p.invert && p.file);
  async function find() {
    if (!ctx.select) return;
    S.st = S.st && S.st.state === 'ready' ? S.st : await moSelectState(ctx.select.bridge, 'subject');
    if (S.st.state !== 'ready') { ctx.afterRecipeChange(false); return; }
    const img = ctx.select.image();
    if (!img) return;
    S.busy = true; S.note = ''; ctx.afterRecipeChange(false);
    try {
      const field = await moSelector(ctx.select.bridge, img).subject(), name = await moFieldName(field);
      moMaskImagePut(name, field);
      void moFieldPng(field).then((bytes) => ctx.select.store(name, bytes)).catch(() => {});
      S.busy = false;
      const x = iso(); x.file = name;
      ctx.afterRecipeChange(true);
    } catch (err) { S.busy = false; S.note = `It did not work: ${(err && err.message) || err}`; ctx.afterRecipeChange(false); }
  }
  function turnOn() {
    const x = iso();
    x.on = true;
    if (!x.file) { const p = fromMasks(); if (p) x.file = p.file; }
    ctx.afterRecipeChange(true);
    if (!x.file) void find();
  }
  async function setUp() {
    S.download = { received: 0, total: moSelectBytes('subject') }; S.error = '';
    ctx.afterRecipeChange(false);
    let last = 0;
    const r = await moSelectSetUp(ctx.select.bridge, 'subject', (got, total) => {
      S.download = { received: got, total };
      if (S.dlText && S.dlText.isConnected) S.dlText.textContent = `Downloading · ${Math.round(got / 1048576)} of ${Math.round(total / 1048576)} MB`;
      else if (Date.now() - last > 500) { last = Date.now(); ctx.afterRecipeChange(false); }
    });
    S.download = null;
    if (r && r.ok) { S.st = { state: 'ready' }; void find(); return; }
    S.error = r && r.stopped ? 'Download stopped.' : `Download failed: ${(r && r.error) || 'no answer'}`;
    ctx.afterRecipeChange(false);
  }

  /** The switch, and what it is doing: in Values and in Colour, the same setting. */
  function control(container, panelDisposers) {
    if (!ctx.select) return;
    const x = iso();
    moPlanSwitch(ui, container, { id: 'media-organizer.plan.isolate', label: 'Ignore background', checked: x.on, onChange: (on) => { if (on) turnOn(); else { iso().on = false; ctx.afterRecipeChange(true); } } }, panelDisposers);
    const mb = (b) => Math.round(b / 1048576);
    if (!x.on) return;
    if (x.file) return; // the grey background says it
    if (S.busy) moPlanHint(container, 'Finding the subject…');
    else if (S.download) {
      S.dlText = moPlanHint(container, `Downloading · ${mb(S.download.received)} of ${mb(S.download.total)} MB`);
      ui.createButton(container, { id: 'media-organizer.plan.isolateCancelSetUp', label: 'Cancel Download', kind: 'ghost', size: 'sm', command: 'media-organizer.plan.isolateCancelSetUp' });
    } else if (S.st && S.st.state === 'model') {
      moPlanHint(container, `${mb(S.st.missing || moSelectBytes('subject'))} MB download · runs on this computer${S.error ? `. ${S.error}` : ''}`);
      ui.createButton(container, { id: 'media-organizer.plan.isolateSetUp', label: 'Download', kind: 'primary', size: 'sm', command: 'media-organizer.plan.isolateSetUp' });
    } else if (S.st && S.st.state !== 'ready') moPlanHint(container, 'Not available in this build.');
    else if (S.note) moPlanHint(container, S.note);
  }

  const acts = {
    isolateSetUp() { if (ctx.select && !S.download) void setUp(); },
    isolateCancelSetUp() { if (ctx.select) moSelectCancel(ctx.select.bridge, 'subject'); },
  };
  const handle = { root: ctx.root, act: (a, ...args) => (acts[a] && state.recipe ? acts[a](...args) : undefined) };
  open.add(handle);
  const used = () => { lastUsed = handle; };
  ctx.root.addEventListener('focusin', used);
  return {
    control,
    dispose() { open.delete(handle); if (lastUsed === handle) lastUsed = null; ctx.root.removeEventListener('focusin', used); },
  };
}
