// edit-masks.js — masks: one part of a photo edited on its own (docs/IMAGE_EDITOR_MASKS.md).
// A mask is made of parts, each added, taken away or intersected: a brush, a
// linear or radial gradient, or one a model finds (edit-select.js): the subject or
// its background, an object clicked, what words name (the sky), or what is
// farther than a distance. A mask has its own settings: the Edit tab's controls
// plus Blur. The Image Editor shows it as its Masks tab, a painting plan
// in its Photo step; both hand in how the picture sits on screen.
//
// Masks live in the recipe (`masks`), in the photo's own pixel space (0..1 across
// the source picture), so a crop or a turn leaves them where they were. The engine
// gets each as a texture (moMaskPasses) and draws the recipe once more per mask,
// laid over the picture so far through it.

import { moEl } from './dom.js';
import { moPointKeys } from './keys.js';
import { MO_SELECT_MODELS, moClipVocab, moFieldName, moFieldPng, moFieldResize, moSelectBytes, moSelectCancel, moSelectSetUp, moSelectState, moSelector } from './edit-select.js';

export const MO_MASK_PARTS = { subject: ['Subject', 'user-round'], object: ['Object', 'mouse-pointer-click'], words: ['Words', 'text-cursor-input'], distance: ['Distance', 'mountain-snow'],
  brush: ['Brush', 'paintbrush'], linear: ['Linear Gradient', 'rows-3'], radial: ['Radial Gradient', 'circle-dot'] };
// The parts a model finds keep their result as an image (a field) named by its content: <hash>.png.
const MODEL_KINDS = new Set(['subject', 'object', 'words', 'distance']);
const FILE_RE = /^[0-9a-f]{24}\.png$/;
/** What a part is called: Background is the subject the other way round, Sky the word sky. */
export const moPartLabel = (p) => (p.kind === 'subject' && p.invert ? 'Background' : p.kind === 'words' ? (p.text ? String(p.text).replace(/\b\w/g, (c) => c.toUpperCase()) : 'Describe') : MO_MASK_PARTS[p.kind][0]);
// [key, label, min, max]: the Edit tab's controls in its own units (rest 0), and Blur.
export const MO_MASK_ADJUST = [['exposure', 'Exposure', -2, 2], ['contrast', 'Contrast', -1, 1], ['highlights', 'Highlights', -1, 1], ['shadows', 'Shadows', -1, 1],
  ['whites', 'Whites', -1, 1], ['blacks', 'Blacks', -1, 1], ['warmth', 'Temperature', -1, 1], ['tint', 'Tint', -1, 1], ['vibrance', 'Vibrance', -1, 1],
  ['saturation', 'Saturation', -1, 1], ['texture', 'Texture', -1, 1], ['clarity', 'Clarity', -1, 1], ['dehaze', 'Dehaze', -1, 1],
  ['sharpen', 'Sharpening', 0, 1.5], ['noise', 'Noise', 0, 1], ['blurAmount', 'Blur', 0, 1]];
export const MO_MASK_LOOKS = [
  ['Recede', 'Push it back: haze, softer, cooler', { dehaze: -0.45, clarity: -0.4, contrast: -0.2, blurAmount: 0.18, warmth: -0.12, saturation: -0.15 }],
  ['Darken Sky', 'Deeper, richer sky', { exposure: -0.6, highlights: -0.4, saturation: 0.1 }],
  ['Lift Subject', 'Brighter, crisper', { exposure: 0.35, shadows: 0.25, clarity: 0.2 }],
];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const colour = (r, g, b, a) => `rgba(${[r, g, b, a].join(", ")})`; // colours drawn over a photo are data, built from numbers
const white = (alpha) => colour(255, 255, 255, alpha); // only the alpha counts: a mask is how much
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-9), 0, 1); return t * t * (3 - 2 * t); };

/** A recipe's masks with everything they need, from whatever was stored. */
export function moMasksNormalize(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m !== 'object') continue;
    const parts = [];
    for (const p of Array.isArray(m.parts) ? m.parts : []) {
      if (!p || !MO_MASK_PARTS[p.kind]) continue;
      const q = { kind: p.kind, op: ['add', 'sub', 'and'].includes(p.op) ? p.op : 'add', invert: p.invert === true };
      if (p.kind === 'linear') Object.assign(q, { x0: num(p.x0, 0.5), y0: num(p.y0, 0.2), x1: num(p.x1, 0.5), y1: num(p.y1, 0.6) });
      if (p.kind === 'radial') Object.assign(q, { cx: num(p.cx, 0.5), cy: num(p.cy, 0.5), rx: Math.max(0.005, num(p.rx, 0.25)), ry: Math.max(0.005, num(p.ry, 0.25)), feather: clamp(num(p.feather, 0.5), 0, 1) });
      if (MODEL_KINDS.has(p.kind)) q.file = FILE_RE.test(String(p.file)) ? String(p.file) : '';
      if (p.kind === 'object') Object.assign(q, { clicks: (Array.isArray(p.clicks) ? p.clicks : []).filter((c) => Array.isArray(c) && c.length === 3).slice(0, 24).map(([u, v, add]) => [clamp(num(u, 0), 0, 1), clamp(num(v, 0), 0, 1), add ? 1 : 0]), box: Array.isArray(p.box) && p.box.length === 4 ? p.box.map((v) => clamp(num(v, 0), 0, 1)) : null });
      if (p.kind === 'words') q.text = String(p.text || '').slice(0, 40);
      if (p.kind === 'distance') Object.assign(q, { from: clamp(num(p.from, 0.5), 0, 1), soft: clamp(num(p.soft, 0.3), 0.02, 1) });
      if (p.kind === 'brush') q.strokes = (Array.isArray(p.strokes) ? p.strokes : []).filter((s) => s && Array.isArray(s.pts)).map((s) => ({ pts: s.pts.filter((x) => Array.isArray(x) && x.length === 2).map(([u, v]) => [num(u, 0), num(v, 0)]), r: Math.max(0.0005, num(s.r, 0.02)), feather: clamp(num(s.feather, 0.6), 0, 1), flow: clamp(num(s.flow, 0.8), 0.02, 1), erase: s.erase === true }));
      parts.push(q);
    }
    if (!parts.length) continue;
    const adjust = {};
    for (const [k, , lo, hi] of MO_MASK_ADJUST) adjust[k] = clamp(num(m.adjust && m.adjust[k], 0), lo, hi);
    out.push({ id: typeof m.id === 'string' && m.id ? m.id : `m${Math.random().toString(36).slice(2, 9)}`, name: String(m.name || 'Mask').slice(0, 40), show: m.show !== false, invert: m.invert === true, parts, adjust });
  }
  return out;
}

// ── the images a model's parts keep ──
// Loaded on first need through the host's loader (moMaskImageLoader); every load wakes whoever drew without it.
const images = new Map(); // file -> { w, h, a } | 'loading' | 'missing'
const imageListeners = new Set();
let imageLoader = null;
/** loader(file) -> Promise<{ w, h, a }>: read a mask image from where the host keeps them. */
export function moMaskImageLoader(loader) { imageLoader = loader; }
export function moMaskImagePut(file, field) { images.set(file, field); for (const f of imageListeners) { try { f(); } catch { /* gone */ } } }
/** Called after an image arrives, so a picture drawn without it is drawn again. */
export function moMaskOnImages(fn) { imageListeners.add(fn); return () => imageListeners.delete(fn); }
function imageOf(file) {
  const x = images.get(file);
  if (x && x.a) return x;
  if (!x && file && imageLoader) { images.set(file, 'loading'); imageLoader(file).then((f) => moMaskImagePut(file, f), () => images.set(file, 'missing')); }
  return null;
}
/** The image files a recipe's masks name (for keeping them when old files are swept). */
export function moMaskFiles(masks) { return (Array.isArray(masks) ? masks : []).flatMap((m) => (m && Array.isArray(m.parts) ? m.parts : []).map((p) => p && p.file).filter((f) => FILE_RE.test(String(f)))); }
/** Every image the masks need, loaded (before a save draws them). */
// Which of a mask's images are in: part of the key the engine holds a mask by, so one arriving re-sends only its masks.
const loadedSig = (m) => m.parts.map((p) => (p.file && images.get(p.file) && images.get(p.file).a ? 1 : 0)).join('');
export async function moMaskImagesReady(masks) {
  await Promise.all(moMaskFiles(masks).map(async (f) => { if (imageOf(f) || !imageLoader) return; try { moMaskImagePut(f, await imageLoader(f)); } catch { images.set(f, 'missing'); } }));
}

// ── the mask as numbers ──
const partCache = new WeakMap(); // a part -> { key, a, canvas, drawn }
function partField(p, w, h) {
  const img = MODEL_KINDS.has(p.kind) ? imageOf(p.file) : null;
  const geo = p.kind === 'brush' ? `${p.strokes.length}:${p.strokes.length ? p.strokes[p.strokes.length - 1].pts.length : 0}` : JSON.stringify(p) + (img ? '+' : '');
  const key = `${w}x${h}|${geo}|${p.invert}`;
  let c = partCache.get(p);
  if (c && c.key === key) return c.a;
  let a = c && c.a && c.a.length === w * h ? c.a : new Float32Array(w * h);
  if (MODEL_KINDS.has(p.kind)) {
    // a model's part: its image over the photo; Distance takes what is farther than `from`, softly
    if (!img) a.fill(0);
    else {
      const r = moFieldResize(img.a, img.w, img.h, w, h);
      if (p.kind === 'distance') for (let i = 0; i < a.length; i++) a[i] = smooth(p.from - p.soft / 2, p.from + p.soft / 2, 1 - r[i]);
      else a.set(r);
    }
  } else if (p.kind === 'linear') {
    const x0 = p.x0 * w, y0 = p.y0 * h, dx = (p.x1 - p.x0) * w, dy = (p.y1 - p.y0) * h, L2 = dx * dx + dy * dy || 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = 1 - smooth(0, 1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L2);
  } else if (p.kind === 'radial') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = 1 - smooth(1 - p.feather, 1, Math.hypot(((x + 0.5) / w - p.cx) / p.rx, ((y + 0.5) / h - p.cy) / p.ry));
  } else {
    // A brush is painted into a canvas a dab at a time; a stroke that only grew paints just its new dabs.
    const fresh = !c || !c.canvas || c.canvas.width !== w || c.canvas.height !== h || !(c.strokes <= p.strokes.length) || (c.strokes === p.strokes.length && c.drawn > (p.strokes[p.strokes.length - 1] || { pts: [] }).pts.length);
    const cv = fresh ? moEl('canvas') : c.canvas;
    if (fresh) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d', { willReadFrequently: true });
    const long = Math.max(w, h);
    const from = fresh ? 0 : Math.max(0, c.strokes - 1);
    let x0 = w, y0 = h, x1 = 0, y1 = 0; // the area painted now
    const dab = (s, r, x, y) => {
      const R = Math.max(r, 0.5), gr = g.createRadialGradient(x, y, r * (1 - s.feather), x, y, R);
      gr.addColorStop(0, white(s.flow)); gr.addColorStop(1, white(0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
      x0 = Math.min(x0, x - R - 1); y0 = Math.min(y0, y - R - 1); x1 = Math.max(x1, x + R + 1); y1 = Math.max(y1, y + R + 1);
    };
    for (let k = from; k < p.strokes.length; k++) {
      const s = p.strokes[k], r = s.r * long, start = !fresh && k === c.strokes - 1 ? c.drawn : 0, gap = Math.max(0.5, r * 0.25);
      g.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      for (let i = start; i < s.pts.length; i++) {
        const x = s.pts[i][0] * w, y = s.pts[i][1] * h;
        if (i > 0) { // a fast stroke's points are far apart: dabs a quarter of the brush apart fill the line between them
          const px = s.pts[i - 1][0] * w, py = s.pts[i - 1][1] * h, n = Math.floor(Math.hypot(x - px, y - py) / gap);
          for (let j = 1; j < n; j++) dab(s, r, px + ((x - px) * j) / n, py + ((y - py) * j) / n);
        }
        dab(s, r, x, y);
      }
    }
    g.globalCompositeOperation = 'source-over';
    const raw = !fresh && c.raw && c.raw.length === w * h ? c.raw : new Float32Array(w * h);
    const rx0 = fresh ? 0 : Math.max(0, Math.floor(x0)), ry0 = fresh ? 0 : Math.max(0, Math.floor(y0));
    const rw = fresh ? w : Math.min(w, Math.ceil(x1)) - rx0, rh = fresh ? h : Math.min(h, Math.ceil(y1)) - ry0;
    if (rw > 0 && rh > 0) {
      const d = g.getImageData(rx0, ry0, rw, rh).data;
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) raw[(ry0 + y) * w + rx0 + x] = d[(y * rw + x) * 4 + 3] / 255;
    }
    a = p.invert ? raw.map((v) => 1 - v) : raw;
    partCache.set(p, { canvas: cv, raw, strokes: p.strokes.length, drawn: p.strokes.length ? p.strokes[p.strokes.length - 1].pts.length : 0, key, a });
    return a;
  }
  if (p.invert) for (let i = 0; i < a.length; i++) a[i] = 1 - a[i];
  partCache.set(p, Object.assign(c || {}, { key, a }));
  return a;
}
/** How much of each pixel the mask covers, 0..1, w x h over the whole photo. */
export function moMaskField(mask, w, h) {
  const m = new Float32Array(w * h);
  mask.parts.forEach((p, k) => {
    const a = partField(p, w, h);
    if (k === 0 || p.op === 'add') for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], a[i]);
    else if (p.op === 'sub') for (let i = 0; i < m.length; i++) m[i] *= 1 - a[i];
    else for (let i = 0; i < m.length; i++) m[i] *= a[i];
  });
  if (mask.invert) for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
  return m;
}
/** The size a mask is worked at: the photo's shape, its long side at most 2048. */
export function moMaskSize(srcW, srcH) {
  const k = Math.min(1, 2048 / Math.max(1, srcW, srcH));
  return { w: Math.max(1, Math.round(srcW * k)), h: Math.max(1, Math.round(srcH * k)) };
}

// ── what the engine draws ──
const engineKeys = new WeakMap(); // an engine -> Map(mask id -> the key it holds)
/**
 * The engine's mask passes for a recipe's masks: each visible mask with settings,
 * its look being `base` with the mask's settings added. Masks the engine does not
 * hold yet (or holds changed) are sent to it first; `alsoKeep` (Show Mask's mask, a plan's subject; one id or a list) stays held.
 */
export function moMaskPasses(engine, masks, base, srcW, srcH, alsoKeep) {
  const list = moMasksNormalizeCached(masks);
  if (!engine || !engine.setMask) return [];
  const held = engineKeys.get(engine) || new Map();
  engineKeys.set(engine, held);
  const { w, h } = moMaskSize(srcW, srcH);
  const out = [], keep = new Set([].concat(alsoKeep || []).filter(Boolean));
  for (const m of list) {
    if (!m.show || !MO_MASK_ADJUST.some(([k]) => Math.abs(m.adjust[k]) > 1e-6)) continue;
    keep.add(m.id);
    const key = `${w}x${h}|${loadedSig(m)}|${JSON.stringify(m.parts)}|${m.invert}`;
    if (held.get(m.id) !== key) {
      const f = moMaskField(m, w, h), bytes = new Uint8Array(w * h);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(f[i] * 255);
      engine.setMask(m.id, bytes, w, h);
      held.set(m.id, key);
    }
    const look = Object.assign({}, base);
    for (const [k, , lo, hi] of MO_MASK_ADJUST) look[k] = k === 'blurAmount' ? m.adjust[k] : clamp((Number(base[k]) || 0) + m.adjust[k], lo * 2, hi * 2);
    out.push({ id: m.id, look });
  }
  for (const id of [...held.keys()]) if (!keep.has(id)) held.delete(id);
  engine.dropMasks(keep);
  return out;
}
/** Send one mask (for Show Mask) even when it has no settings yet. */
export function moMaskEnsure(engine, mask, srcW, srcH) {
  if (!engine || !engine.setMask || !mask) return null;
  const held = engineKeys.get(engine) || new Map();
  engineKeys.set(engine, held);
  const { w, h } = moMaskSize(srcW, srcH);
  const key = `${w}x${h}|${loadedSig(mask)}|${JSON.stringify(mask.parts)}|${mask.invert}`;
  if (held.get(mask.id) !== key) {
    const f = moMaskField(mask, w, h), bytes = new Uint8Array(w * h);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(f[i] * 255);
    engine.setMask(mask.id, bytes, w, h);
    held.set(mask.id, key);
  }
  return mask.id;
}
// The editor mutates its recipe's masks in place; parts keep their identity, so their caches hold.
function moMasksNormalizeCached(masks) { return Array.isArray(masks) ? masks : []; }

// ── the Masks tool ──
const ACTIONS = ['masksNew', 'masksSelect', 'masksShow', 'masksMore', 'masksPart', 'masksAddPart', 'masksRemovePart', 'masksLook', 'masksReset', 'masksOverlay',
  'masksSetUp', 'masksCancelSetUp', 'masksClearClicks', 'masksFindWords'];
// The menus' ways to start a part: [kind, label, what the part starts with]; null is a line between.
const MENU = [['subject', 'Subject', {}], ['subject', 'Background', { invert: true }], ['words', 'Sky', { text: 'sky' }], ['object', 'Object', {}], ['words', 'Describe', {}], ['distance', 'Distance', {}], null,
  ['brush', 'Brush', {}], ['linear', 'Linear Gradient', {}], ['radial', 'Radial Gradient', {}]];
const BUSY = { subject: 'Finding the subject…', object: 'Selecting…', words: 'Searching…', distance: 'Measuring depth…' };
const titleCase = (t) => String(t).replace(/\b\w/g, (c) => c.toUpperCase());
const way = (p) => (p && MODEL_KINDS.has(p.kind) ? p.kind : null);
// Each Masks tool (the editor's, a plan's) is named in its buttons' commands, so the one clicked answers.
const open = new Map();
let seq = 0;
export function moEditMasksActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.${a}`, (who, ...args) => { const p = open.get(who); return p ? p.act(a, ...args) : undefined; }));
}

/**
 * ctx: { api, root, kit (moEditPanelKit), host (the element over the picture),
 *   recipe(), afterChange(record), requestRender(), on() -> the tool is showing,
 *   toScreen(u, v) -> { x, y } in host pixels, fromScreen(clientX, clientY) -> { u, v } on the photo,
 *   screenPerPhoto() -> screen pixels per photo pixel, photoSize() -> { w, h }, idStem,
 *   hostPoint(clientX, clientY) -> { x, y } in host pixels and hostScale() -> screen pixels per host pixel,
 *   for a host that is scaled or mirrored (a plan's zoomed view); without them the host is as it shows }.
 * The brush's size is on the screen: zoomed in, it paints finer.
 * select (when models can run): { bridge (the model runner), image() -> the photo in its own pixels,
 *   store(name, bytes) -> keeps a mask image where the loader (moMaskImageLoader) finds it }.
 */
export function moEditMasks(ctx) {
  const { api } = ctx;
  const ui = api.ui;
  const S = { sel: 0, part: 0, overlay: true, brush: { size: 80, feather: 0.6, flow: 0.8, erase: false } };
  const me = `masks-${++seq}`;
  const disposers = [];
  const masks = () => { const r = ctx.recipe(); if (!r) return []; if (!Array.isArray(r.masks)) r.masks = []; return r.masks; };
  const cur = () => masks()[S.sel] || null;
  const part = () => { const m = cur(); return m ? m.parts[Math.min(S.part, m.parts.length - 1)] || null : null; };
  const id = (s) => `${ctx.idStem}.${s}`;
  // What the models need and are doing: each way's state, a download, the part being found, a note on the last try.
  const SEL = { ways: {}, download: null, downloadError: '', busy: null, note: '', selector: null, img: null, seq: 0, words: null, drag: null, statusEl: null, dlEls: null };
  const say = (text) => { if (SEL.statusEl && SEL.statusEl.isConnected) SEL.statusEl.textContent = text; else ctx.afterChange(false); };
  const tried = new WeakSet();
  const selector = () => { const img = ctx.select && ctx.select.image(); if (!img) return null; if (SEL.img !== img) { SEL.img = img; SEL.selector = moSelector(ctx.select.bridge, img); } return SEL.selector; };
  const checkWay = async (w) => { SEL.ways[w] = await moSelectState(ctx.select && ctx.select.bridge, w); return SEL.ways[w]; };
  /** Run a model's part and keep what it found. */
  async function find(p) {
    const w = way(p);
    if (!w || !ctx.select) return;
    tried.add(p);
    const st = SEL.ways[w] && SEL.ways[w].state === 'ready' ? SEL.ways[w] : await checkWay(w);
    if (st.state !== 'ready') { ctx.afterChange(false); return; } // the panel shows how to set it up
    const sel = selector();
    if (!sel || (p.kind === 'words' && !p.text)) return;
    if (p.kind === 'object' && !p.clicks.length && !p.box) { p.file = ''; ctx.afterChange(true); return; }
    const n = ++SEL.seq;
    SEL.busy = { part: p }; SEL.note = ''; say(BUSY[p.kind]);
    try {
      let field = null;
      if (p.kind === 'subject') field = await sel.subject();
      else if (p.kind === 'object') field = await sel.object(p.clicks, p.box);
      else if (p.kind === 'distance') field = await sel.distance();
      else {
        field = await sel.words(p.text, await moClipVocab());
        if (field && field.unknown) { SEL.note = `Try a simpler word than “${p.text}”.`; field = null; }
        else if (!field) SEL.note = `No “${p.text}” in this photo.`;
      }
      if (n !== SEL.seq) return;
      SEL.busy = null;
      if (!field && !p.file) { say(SEL.note); return; } // nothing to keep: only the line changes
      if (field) {
        // shown at once; its PNG is written after (encoding takes longer than finding it on screen)
        const name = await moFieldName(field); moMaskImagePut(name, field); p.file = name;
        void moFieldPng(field).then((bytes) => ctx.select.store(name, bytes)).catch((err) => console.warn('[MediaOrganizer] a mask image was not kept:', err && err.message));
        const m = masks().find((x) => x.parts.includes(p));
        if (m && p.kind === 'words' && /^Mask \d+$/.test(m.name)) m.name = titleCase(p.text).slice(0, 40); // named after what was found
      } else p.file = '';
      ctx.afterChange(true);
    } catch (err) {
      if (n !== SEL.seq) return;
      SEL.busy = null; SEL.note = `Couldn’t select: ${(err && err.message) || err}`;
      say(SEL.note);
    }
  }
  async function setUp(w) {
    SEL.download = { way: w, received: 0, total: moSelectBytes(w) }; SEL.downloadError = '';
    ctx.afterChange(false);
    let last = 0;
    // progress moves the bar in place; the panel is rebuilt only if it was rebuilt meanwhile
    const r = await moSelectSetUp(ctx.select.bridge, w, (got, total) => {
      SEL.download = { way: w, received: got, total };
      const e = SEL.dlEls;
      if (e && e.fill.isConnected) { e.fill.style.width = `${Math.round((got / Math.max(1, total)) * 100)}%`; e.text.textContent = `${Math.round(got / 1048576)} of ${Math.round(total / 1048576)} MB`; }
      else if (Date.now() - last > 500) { last = Date.now(); ctx.afterChange(false); }
    });
    SEL.download = null;
    if (r && r.ok) { SEL.ways[w] = { state: 'ready' }; const p = part(); if (p && way(p) === w) { ctx.afterChange(false); void find(p); return; } }
    else SEL.downloadError = r && r.stopped ? 'Download stopped. Nothing was kept.' : `Download failed: ${(r && r.error) || 'no answer'}`;
    ctx.afterChange(false);
  }

  // ── on the picture ──
  const layer = moEl('div', 'mo-mk-layer mo-hidden');
  const handles = moEl('div', 'mo-mk-handles');
  const cursor = moEl('div', 'mo-mk-cursor mo-hidden', { 'aria-hidden': 'true' });
  const lines = moEl('canvas', 'mo-mk-lines', { 'aria-hidden': 'true' });
  layer.append(lines, handles, cursor);
  ctx.host.appendChild(layer);
  let stroke = null, keyPoint = null;
  const hostScale = () => (ctx.hostScale ? ctx.hostScale() : 1) || 1;
  const hostPoint = (x, y) => { if (ctx.hostPoint) return ctx.hostPoint(x, y); const r = ctx.host.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
  const placeCursor = (x, y) => {
    const k = hostScale(), d = S.brush.size / k;
    Object.assign(cursor.style, { left: `${x}px`, top: `${y}px`, width: `${d}px`, height: `${d}px`, borderWidth: `${1.5 / k}px` });
    cursor.style.setProperty('--mo-mk-inner', `${(d / 2) * (1 - S.brush.feather)}px`);
    cursor.style.setProperty('--mo-mk-line', `${1 / k}px`);
    cursor.classList.remove('mo-hidden');
  };
  const brushR = () => { const ps = ctx.photoSize(); return (S.brush.size / 2) / Math.max(1e-6, ctx.screenPerPhoto()) / Math.max(ps.w, ps.h); };
  const press = ui.onDragPress(layer, (e) => {
    const p = part();
    if (p && p.kind === 'object' && (e.button === undefined || e.button === 0)) {
      // a click selects what is under it (Shift: takes it away); a drag draws a box round a thing
      e.preventDefault();
      const at = ctx.fromScreen(e.clientX, e.clientY);
      SEL.drag = { x: e.clientX, y: e.clientY, u: at.u, v: at.v, u1: at.u, v1: at.v, shift: !!e.shiftKey, moved: false };
      try { layer.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
      return;
    }
    if (!p || p.kind !== 'brush' || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    const at = ctx.fromScreen(e.clientX, e.clientY);
    stroke = { pts: [[at.u, at.v]], r: brushR(), feather: S.brush.feather, flow: S.brush.flow, erase: S.brush.erase || !!e.altKey };
    p.strokes.push(stroke);
    try { layer.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
    ctx.requestRender();
  }, { pointerEvents: true });
  disposers.push(() => press.dispose());
  const onMove = (e) => {
    if (SEL.drag) {
      const q = ctx.fromScreen(e.clientX, e.clientY);
      SEL.drag.u1 = q.u; SEL.drag.v1 = q.v;
      if (Math.hypot(e.clientX - SEL.drag.x, e.clientY - SEL.drag.y) > 6) SEL.drag.moved = true;
      if (SEL.drag.moved) sync();
      return;
    }
    const p = part();
    if (p && p.kind === 'brush') {
      const q = hostPoint(e.clientX, e.clientY);
      placeCursor(q.x, q.y);
    }
    if (!stroke) return;
    const at = ctx.fromScreen(e.clientX, e.clientY), last = stroke.pts[stroke.pts.length - 1];
    if (Math.hypot(at.u - last[0], at.v - last[1]) < stroke.r * 0.25) return; // dabs a quarter of the brush apart
    stroke.pts.push([at.u, at.v]);
    ctx.requestRender();
  };
  const onUp = () => {
    const d = SEL.drag, p = part();
    SEL.drag = null;
    if (d && p && p.kind === 'object') {
      if (d.moved) p.box = [Math.min(d.u, d.u1), Math.min(d.v, d.v1), Math.max(d.u, d.u1), Math.max(d.v, d.v1)].map((x) => clamp(x, 0, 1));
      else p.clicks.push([clamp(d.u, 0, 1), clamp(d.v, 0, 1), d.shift ? 0 : 1]);
      void find(p);
      return;
    }
    if (stroke) { stroke = null; ctx.afterChange(true); }
  };
  layer.addEventListener('pointermove', onMove); layer.addEventListener('pointerup', onUp); layer.addEventListener('pointercancel', onUp);
  layer.addEventListener('pointerleave', () => cursor.classList.add('mo-hidden'));
  // The keyboard's brush: the arrows move a point, Enter paints a dab there.
  disposers.push(moPointKeys(layer, 'Photo. Arrow keys move the point, Enter paints or selects, Shift+Enter takes away.', {
    move: (dx, dy) => { keyPoint = keyPoint || { u: 0.5, v: 0.5 }; keyPoint = { u: clamp(keyPoint.u + dx * 0.01, 0, 1), v: clamp(keyPoint.v + dy * 0.01, 0, 1) }; sync(); },
    take: (e) => {
      const p = part();
      if (p && p.kind === 'object') { keyPoint = keyPoint || { u: 0.5, v: 0.5 }; p.clicks.push([keyPoint.u, keyPoint.v, e && e.shiftKey ? 0 : 1]); void find(p); return; }
      if (!p || p.kind !== 'brush') return; keyPoint = keyPoint || { u: 0.5, v: 0.5 }; p.strokes.push({ pts: [[keyPoint.u, keyPoint.v]], r: brushR(), feather: S.brush.feather, flow: S.brush.flow, erase: S.brush.erase }); ctx.afterChange(true); },
  }));
  function handle(u, v, cls, label, move) {
    const at = ctx.toScreen(u, v);
    const h = moEl('div', `mo-mk-h ${cls || ''}`, { tabindex: '0', role: 'button', 'aria-label': label, title: label });
    h.style.left = `${at.x}px`; h.style.top = `${at.y}px`;
    const d = ui.onDragPress(h, (e) => {
      e.preventDefault(); e.stopPropagation();
      try { h.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
      const mv = (ev) => { const q = ctx.fromScreen(ev.clientX, ev.clientY); move(q.u, q.v); ctx.requestRender(); };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); ctx.afterChange(true); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    }, { pointerEvents: true });
    h.addEventListener('keydown', (e) => {
      const a = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      const k = e.shiftKey ? 0.05 : 0.01;
      move(u + a[0] * k, v + a[1] * k); ctx.afterChange(true);
    });
    handles.appendChild(h);
    return d;
  }
  let handleDisposers = [];
  /** After every draw: the layer, the gradient's handles and lines, the brush's cursor. */
  function sync() {
    const on = ctx.on() && !!cur();
    layer.classList.toggle('mo-hidden', !on);
    const held = handles.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null; // the handle the keyboard is on, found again after the rebuild
    for (const d of handleDisposers.splice(0)) { try { d.dispose(); } catch { /* gone */ } }
    handles.replaceChildren();
    const W = ctx.host.clientWidth, H = ctx.host.clientHeight, dpr = window.devicePixelRatio || 1;
    if (lines.width !== Math.round(W * dpr)) lines.width = Math.round(W * dpr);
    if (lines.height !== Math.round(H * dpr)) lines.height = Math.round(H * dpr);
    const g = lines.getContext('2d'); g.clearRect(0, 0, lines.width, lines.height);
    if (!on) return;
    const p = part();
    layer.classList.toggle('is-brush', !!p && p.kind === 'brush');
    layer.classList.toggle('is-pick', !!p && p.kind === 'object');
    if (!p || p.kind !== 'brush') cursor.classList.add('mo-hidden');
    if (layer.tabIndex !== 0 && p && (p.kind === 'brush' || p.kind === 'object')) layer.tabIndex = 0;
    if (!p) return;
    g.save(); g.scale(dpr, dpr); g.strokeStyle = 'white'; g.lineWidth = 1.5; g.shadowColor = 'black'; g.shadowBlur = 2;
    const line = (a, b, dash) => { g.setLineDash(dash ? [6, 5] : []); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
    if (p.kind === 'linear') {
      const a = ctx.toScreen(p.x0, p.y0), b = ctx.toScreen(p.x1, p.y1), dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * 4000, ny = (dx / len) * 4000;
      for (const [q, dash] of [[a, false], [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, true], [b, false]]) line({ x: q.x - nx, y: q.y - ny }, { x: q.x + nx, y: q.y + ny }, dash);
      handleDisposers.push(handle(p.x0, p.y0, '', 'Where the edit is full', (u, v) => { p.x0 = u; p.y0 = v; }));
      handleDisposers.push(handle(p.x1, p.y1, '', 'Where the edit ends', (u, v) => { p.x1 = u; p.y1 = v; }));
      handleDisposers.push(handle((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, 'is-pin', 'Move the gradient', (u, v) => { const cu = (p.x0 + p.x1) / 2, cv = (p.y0 + p.y1) / 2; p.x0 += u - cu; p.x1 += u - cu; p.y0 += v - cv; p.y1 += v - cv; }));
    } else if (p.kind === 'radial') {
      const ring = (k, dash) => { g.setLineDash(dash ? [6, 5] : []); g.beginPath(); for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2, q = ctx.toScreen(p.cx + Math.cos(t) * p.rx * k, p.cy + Math.sin(t) * p.ry * k); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); } g.stroke(); };
      ring(1, false); ring(1 - p.feather, true);
      handleDisposers.push(handle(p.cx, p.cy, 'is-pin', 'Move the oval', (u, v) => { p.cx = u; p.cy = v; }));
      handleDisposers.push(handle(p.cx + p.rx, p.cy, '', 'Oval width', (u) => { p.rx = Math.max(0.005, Math.abs(u - p.cx)); }));
      handleDisposers.push(handle(p.cx, p.cy - p.ry, '', 'Oval height', (u, v) => { p.ry = Math.max(0.005, Math.abs(p.cy - v)); }));
    } else if (p.kind === 'object') {
      const box = SEL.drag && SEL.drag.moved ? [SEL.drag.u, SEL.drag.v, SEL.drag.u1, SEL.drag.v1] : p.box;
      if (box) { const a = ctx.toScreen(box[0], box[1]), b = ctx.toScreen(box[2], box[3]); g.setLineDash([6, 5]); g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.setLineDash([]); }
      for (const [u, v, add] of p.clicks) {
        const q = ctx.toScreen(u, v);
        g.beginPath(); g.arc(q.x, q.y, 6, 0, Math.PI * 2); g.fillStyle = add ? colour(46, 204, 113, 0.95) : colour(231, 76, 60, 0.95); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(q.x - 3, q.y); g.lineTo(q.x + 3, q.y); if (add) { g.moveTo(q.x, q.y - 3); g.lineTo(q.x, q.y + 3); } g.stroke();
      }
      if (keyPoint && document.activeElement === layer) { const q = ctx.toScreen(keyPoint.u, keyPoint.v); g.beginPath(); g.arc(q.x, q.y, 9, 0, Math.PI * 2); g.stroke(); }
    } else if (keyPoint && document.activeElement === layer) {
      const q = ctx.toScreen(keyPoint.u, keyPoint.v);
      placeCursor(q.x, q.y);
    }
    g.restore();
    if (held) { const again = [...handles.children].find((x) => x.getAttribute('aria-label') === held); if (again) again.focus({ preventScroll: true }); }
  }

  // ── the panel ──
  function thumb(canvas, m) {
    const w = 40, h = 28, f = moMaskField(m, w, h), d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = f[i] * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    canvas.width = w; canvas.height = h; canvas.getContext('2d').putImageData(new ImageData(d, w, h), 0, 0);
  }
  const partsText = (m) => m.parts.map((p, j) => (j ? (p.op === 'sub' ? '− ' : p.op === 'and' ? '∩ ' : '+ ') : '') + moPartLabel(p)).join(' ') + (m.invert ? ', inverted' : '');
  /** A model's part in the panel: how to set it up, or its own controls and what it is doing. */
  function modelPanel(cover, p, panelDisposers) {
    const w = way(p), info = MO_SELECT_MODELS[w], st = SEL.ways[w];
    const status = (text) => cover.appendChild(moEl('div', 'mo-mk-status', { role: 'status', textContent: text }));
    if (!ctx.select) { status('Not available in this build.'); return; }
    if (!st) { status('Checking…'); void checkWay(w).then(() => ctx.afterChange(false)); return; }
    if (st.state !== 'ready') {
      const card = moEl('div', 'mo-edit-setup mo-mk-setup'), dl = SEL.download && SEL.download.way === w ? SEL.download : null, mb = (b) => Math.round(b / 1048576);
      if (st.state === 'model') {
        card.title = `${info.does} ${info.model}, kept only if it is exactly the file tested. Photos are never sent anywhere.`;
        card.append(moEl('div', 'mo-edit-setup-title', { textContent: info.title }), moEl('p', null, { textContent: `${mb(st.missing || moSelectBytes(w))} MB download · runs on this computer` }));
        if (dl) {
          const bar = moEl('div', 'mo-edit-progress'), fill = moEl('div', 'mo-edit-progress-fill'), text = moEl('p', null, { textContent: `${mb(dl.received)} of ${mb(dl.total)} MB` });
          fill.style.width = `${Math.round((dl.received / Math.max(1, dl.total)) * 100)}%`; bar.appendChild(fill);
          card.append(bar, text);
          SEL.dlEls = { fill, text };
          ui.createButton(card, { id: id('cancelSetUp'), label: 'Cancel Download', kind: 'ghost', size: 'sm', command: 'media-organizer.masksCancelSetUp', args: [me, w] });
        } else {
          ui.createButton(card, { id: id('setUp'), label: 'Download', kind: 'primary', size: 'sm', command: 'media-organizer.masksSetUp', args: [me, w] });
          if (SEL.downloadError) card.appendChild(moEl('p', null, { textContent: SEL.downloadError }));
        }
      } else card.append(moEl('div', 'mo-edit-setup-title', { textContent: info.title }), moEl('p', null, { textContent: st.state === 'runtime' ? 'The model runner is missing from this install.' : 'Not available in this build.' }));
      cover.appendChild(card);
      return;
    }
    if (p.kind === 'words' && p.text !== 'sky') {
      const input = ui.createInput(null, { id: id('words'), label: 'What to select', placeholder: 'water, trees, hair…', value: p.text });
      SEL.words = input; panelDisposers.push(() => { input.dispose(); if (SEL.words === input) SEL.words = null; });
      const row = moEl('div', 'mo-mk-words'); row.appendChild(input.element);
      ui.createButton(row, { id: id('findWords'), label: 'Select', size: 'sm', command: 'media-organizer.masksFindWords', args: [me] });
      cover.appendChild(row);
    }
    if (p.kind === 'object') {
      cover.appendChild(ctx.kit.hint('Click to add · Shift-click to remove · Drag a box'));
      if (p.clicks.length || p.box) ui.createButton(cover.appendChild(moEl('div', 'mo-mk-actions')), { id: id('clearClicks'), label: 'Clear Clicks', icon: 'eraser', kind: 'ghost', size: 'sm', command: 'media-organizer.masksClearClicks', args: [me] });
    }
    if (p.kind === 'distance') {
      cover.appendChild(ctx.kit.sliderRow({ id: 'mask-distance-from', label: 'Farther than', min: 0, max: 1, rest: 0.5, step: 0.01, value: p.from, show: (v) => `${Math.round(v * 100)}%`, parse: (t) => { const n = Number(String(t).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? clamp(n / 100, 0, 1) : null; }, onInput: (v) => { p.from = v; ctx.requestRender(); }, onChange: (v) => { p.from = v; ctx.afterChange(true); } }).row);
      cover.appendChild(ctx.kit.sliderRow({ id: 'mask-distance-soft', label: 'Feather', min: 0.02, max: 1, rest: 0.3, step: 0.01, value: p.soft, show: (v) => `${Math.round(v * 100)}%`, parse: (t) => { const n = Number(String(t).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? clamp(n / 100, 0.02, 1) : null; }, onInput: (v) => { p.soft = v; ctx.requestRender(); }, onChange: (v) => { p.soft = v; ctx.afterChange(true); } }).row);
    }
    // one line, always there, so what a model is doing shows without rebuilding the panel
    SEL.statusEl = moEl('div', 'mo-mk-status', { role: 'status', textContent: SEL.busy && SEL.busy.part === p ? BUSY[p.kind] : SEL.note });
    cover.appendChild(SEL.statusEl);
    if (!p.file && !tried.has(p) && !SEL.busy && (p.kind === 'subject' || p.kind === 'distance' || (p.kind === 'words' && p.text))) queueMicrotask(() => void find(p));
  }
  function panel(container, panelDisposers) {
    const list = masks();
    if (S.sel >= list.length) S.sel = list.length - 1;
    const body = ctx.kit.openSection(container, 'masks', 'Masks', { dot: list.length > 0 });
    const top = moEl('div', 'mo-mk-top');
    const ov = ui.createIconButton(top, { id: id('overlay'), icon: 'eye', title: S.overlay ? 'Hide The Mask Overlay' : 'Show The Mask In Red', size: 'sm', command: 'media-organizer.masksOverlay', args: [me] });
    ov.setAttribute('aria-pressed', String(S.overlay));
    const nb = ui.createButton(top, { id: id('new'), label: 'New Mask', icon: 'plus', kind: 'primary', size: 'sm', command: 'media-organizer.masksNew', args: [me] });
    nb.setAttribute('aria-haspopup', 'menu');
    body.appendChild(top);
    if (!list.length) body.appendChild(ctx.kit.hint('Select part of the photo to edit it on its own.'));
    const rows = moEl('div', 'mo-mk-list', { role: 'group', 'aria-label': 'Masks' });
    list.forEach((m, k) => {
      const row = moEl('div', 'mo-mk-row');
      const b = ui.createButton(row, { id: id(`mask.${k}`), label: m.name, kind: 'ghost', size: 'sm', command: 'media-organizer.masksSelect', args: [me, k], title: `${m.name}: ${partsText(m)}` });
      b.classList.add('mo-mk-mask'); b.setAttribute('aria-pressed', String(k === S.sel));
      const cv = moEl('canvas', 'mo-mk-thumb', { 'aria-hidden': 'true' }); thumb(cv, m); b.prepend(cv);
      if (partsText(m) !== m.name) b.appendChild(moEl('span', 'mo-mk-sub', { textContent: partsText(m) })); // "Subject" under "Subject" says nothing
      else b.classList.add('is-single');
      const eye = ui.createIconButton(row, { id: id(`show.${k}`), icon: m.show ? 'eye' : 'eye-off', title: m.show ? `Hide ${m.name}'s Edit` : `Show ${m.name}'s Edit`, size: 'sm', command: 'media-organizer.masksShow', args: [me, k] });
      eye.setAttribute('aria-pressed', String(!m.show));
      ui.createIconButton(row, { id: id(`more.${k}`), icon: 'ellipsis', title: `More For ${m.name}`, size: 'sm', command: 'media-organizer.masksMore', args: [me, k] }).setAttribute('aria-haspopup', 'menu');
      rows.appendChild(row);
    });
    body.appendChild(rows);
    const m = cur();
    if (!m) return;

    const cover = ctx.kit.openSection(container, 'mask-parts', 'What the mask covers');
    const parts = moEl('div', 'mo-mk-parts', { role: 'group', 'aria-label': 'Parts of the mask' });
    m.parts.forEach((p, j) => {
      const row = moEl('div', 'mo-mk-row');
      const op = j === 0 || p.op === 'add' ? 'Added' : p.op === 'sub' ? 'Taken away' : 'Intersected';
      const b = ui.createButton(row, { id: id(`part.${j}`), label: moPartLabel(p), icon: MO_MASK_PARTS[p.kind][1], kind: 'ghost', size: 'sm', command: 'media-organizer.masksPart', args: [me, j], title: op });
      b.classList.add('mo-mk-part'); b.setAttribute('aria-pressed', String(j === S.part));
      b.prepend(moEl('span', `mo-mk-op${p.op === 'sub' && j ? ' is-sub' : ''}`, { textContent: j === 0 || p.op === 'add' ? '+' : p.op === 'sub' ? '−' : '∩', 'aria-hidden': 'true' }));
      if (m.parts.length > 1) ui.createIconButton(row, { id: id(`removePart.${j}`), icon: 'x', title: `Remove ${moPartLabel(p)} From The Mask`, size: 'sm', command: 'media-organizer.masksRemovePart', args: [me, j] });
      parts.appendChild(row);
    });
    cover.appendChild(parts);
    const ops = moEl('div', 'mo-mk-ops');
    for (const [op, label] of [['add', 'Add'], ['sub', 'Subtract'], ['and', 'Intersect']]) ui.createButton(ops, { id: id(`addPart.${op}`), label, size: 'sm', command: 'media-organizer.masksAddPart', args: [me, op] }).setAttribute('aria-haspopup', 'menu');
    cover.appendChild(ops);
    const p = part();
    const slider = (key, label, min, max, rest, value, show, set, step) => cover.appendChild(ctx.kit.sliderRow({ id: `mask-${key}`, label, min, max, rest, step, value, show, parse: (t) => { const n = Number(String(t).replace(/[^\d.+-]/g, '')); return Number.isFinite(n) ? clamp(n, min, max) : null; }, onInput: set, onChange: (v) => { set(v); ctx.afterChange(false); } }).row);
    if (p && p.kind === 'brush') {
      slider('size', 'Size', 4, 400, 80, S.brush.size, (v) => `${Math.round(v)} px`, (v) => { S.brush.size = v; }, 1);
      slider('feather', 'Feather', 0, 1, 0.6, S.brush.feather, (v) => `${Math.round(v * 100)}%`, (v) => { S.brush.feather = v; });
      slider('flow', 'Flow', 0.05, 1, 0.8, S.brush.flow, (v) => `${Math.round(v * 100)}%`, (v) => { S.brush.flow = v; });
      const t = ui.createToggle(null, { id: id('erase'), label: 'Erase', checked: S.brush.erase, onChange: (on) => { S.brush.erase = on; } });
      panelDisposers.push(() => t.dispose());
      const row = moEl('div', 'mo-mk-switch'); row.append(moEl('span', null, { textContent: 'Erase (or hold Alt)', 'aria-hidden': 'true' }), t.element); cover.appendChild(row);
      cover.appendChild(ctx.kit.hint('Paint on the photo. From the keyboard: Tab to the photo, the arrow keys move the brush, Enter paints.'));
    }
    if (p && p.kind === 'radial') slider('ovalFeather', 'Feather', 0, 1, 0.5, p.feather, (v) => `${Math.round(v * 100)}%`, (v) => { p.feather = v; ctx.requestRender(); });
    if (p && p.kind === 'linear') cover.appendChild(ctx.kit.hint('Drag the lines on the photo: the edit is full at the first and gone past the last.'));
    if (p && way(p)) modelPanel(cover, p, panelDisposers);
    if (p) {
      const t = ui.createToggle(null, { id: id('invertPart'), label: 'Invert this part', checked: p.invert, onChange: (on) => { p.invert = on; ctx.afterChange(true); } });
      panelDisposers.push(() => t.dispose());
      const row = moEl('div', 'mo-mk-switch'); row.append(moEl('span', null, { textContent: 'Invert this part', 'aria-hidden': 'true' }), t.element); cover.appendChild(row);
    }

    const rest = MO_MASK_ADJUST.every(([k]) => Math.abs(m.adjust[k]) < 1e-6);
    const adj = ctx.kit.openSection(container, 'mask-adjust', `Edit inside ${m.name}`, { dot: !rest, reset: { disabled: rest, title: `Reset ${m.name}'s Edit`, run: () => act('masksReset') } });
    const looks = moEl('div', 'mo-mk-looks', { role: 'group', 'aria-label': 'Starting points' });
    for (const [name, title] of MO_MASK_LOOKS) ui.createButton(looks, { id: id(`look.${name.toLowerCase().replace(/\s+/g, '-')}`), label: name, kind: 'secondary', size: 'sm', title, command: 'media-organizer.masksLook', args: [me, name] });
    adj.appendChild(looks);
    for (const [k, label, min, max] of MO_MASK_ADJUST) {
      adj.appendChild(ctx.kit.sliderRow({ id: `mask-adjust-${k}`, label, min, max, rest: 0, value: m.adjust[k], step: 0.01,
        show: (v) => (k === 'exposure' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}` : `${v > 0 && k !== 'blurAmount' ? '+' : ''}${Math.round(v * 100)}`),
        parse: (t) => { const n = Number(String(t).replace(',', '.').replace('+', '').trim()); return Number.isFinite(n) && String(t).trim() !== '' ? clamp(k === 'exposure' ? n : n / 100, min, max) : null; },
        onInput: (v) => { m.adjust[k] = v; ctx.requestRender(); }, onChange: (v) => { m.adjust[k] = v; ctx.afterChange(true); } }).row);
    }
  }

  // ── what each command does ──
  const kindItems = (run) => MENU.filter((x) => !x || !MODEL_KINDS.has(x[0]) || ctx.select).map((x) => (x ? { label: x[1], icon: MO_MASK_PARTS[x[0]][1], onSelect: () => run(x[0], x[2], x[1]) } : { separator: true }));
  const startPart = (q) => { if (way(q) && (q.kind !== 'words' || q.text) && q.kind !== 'object') void find(q); };
  const anchor = (sel) => ctx.root.querySelector(`[data-px-id="${sel}"]`);
  const newPart = (kind, op) => {
    const q = { kind, op, invert: false };
    if (kind === 'linear') Object.assign(q, { x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.55 });
    if (kind === 'radial') Object.assign(q, { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.3, feather: 0.5 });
    if (kind === 'brush') q.strokes = [];
    if (MODEL_KINDS.has(kind)) q.file = '';
    if (kind === 'object') Object.assign(q, { clicks: [], box: null });
    if (kind === 'words') q.text = '';
    if (kind === 'distance') Object.assign(q, { from: 0.5, soft: 0.3 });
    return q;
  };
  function act(name, ...args) {
    const list = masks(), m = cur();
    if (name === 'masksNew') return ui.createMenu(anchor(id('new')) || ctx.root, { id: id('newMenu'), label: 'New Mask', items: kindItems((kind, extra, label) => {
      const q = Object.assign(newPart(kind, 'add'), extra);
      list.push({ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: way(q) && !(q.kind === 'words' && !q.text) ? label : `Mask ${list.length + 1}`, show: true, invert: false, parts: [q], adjust: Object.fromEntries(MO_MASK_ADJUST.map(([k]) => [k, 0])) });
      S.sel = list.length - 1; S.part = 0; S.overlay = true; SEL.note = ''; ctx.afterChange(true); startPart(q);
    }) });
    if (name === 'masksSelect') { S.sel = Number(args[0]) || 0; S.part = (cur() ? cur().parts.length : 1) - 1; return ctx.afterChange(false); }
    if (name === 'masksShow') { const x = list[Number(args[0])]; if (x) { x.show = !x.show; ctx.afterChange(true); } return undefined; }
    if (name === 'masksOverlay') { S.overlay = !S.overlay; return ctx.afterChange(false); }
    if (name === 'masksMore') {
      const k = Number(args[0]), x = list[k];
      if (!x) return undefined;
      return ui.createMenu(anchor(id(`more.${k}`)) || ctx.root, { id: id('maskMenu'), label: `More For ${x.name}`, items: [
        { label: x.invert ? 'Uninvert' : 'Invert', onSelect: () => { x.invert = !x.invert; ctx.afterChange(true); } },
        { label: 'Duplicate', onSelect: () => { const copy = JSON.parse(JSON.stringify(x)); copy.id = `m${Date.now().toString(36)}`; copy.name = `${x.name} copy`.slice(0, 40); list.splice(k + 1, 0, copy); S.sel = k + 1; ctx.afterChange(true); } },
        { label: 'Rename…', onSelect: async () => { const n = await api.window.showInputBox({ prompt: 'Name this mask', value: x.name }); if (n && String(n).trim()) { x.name = String(n).trim().slice(0, 40); ctx.afterChange(true); } } },
        { separator: true },
        { label: 'Delete Mask', danger: true, onSelect: () => { list.splice(k, 1); S.sel = Math.min(S.sel, list.length - 1); S.part = 0; ctx.afterChange(true); } },
      ] });
    }
    if (!m) return undefined;
    if (name === 'masksPart') { S.part = Number(args[0]) || 0; return ctx.afterChange(false); }
    if (name === 'masksAddPart') { const op = args[0]; return ui.createMenu(anchor(id(`addPart.${op}`)) || ctx.root, { id: id('partMenu'), label: 'Add To The Mask', items: kindItems((kind, extra) => { const q = Object.assign(newPart(kind, op), extra); m.parts.push(q); S.part = m.parts.length - 1; SEL.note = ''; ctx.afterChange(true); startPart(q); }) }); }
    if (name === 'masksSetUp') return void setUp(args[0]);
    if (name === 'masksCancelSetUp') { if (ctx.select) moSelectCancel(ctx.select.bridge, args[0]); return undefined; }
    if (name === 'masksClearClicks') { const p = part(); if (p && p.kind === 'object') { p.clicks = []; p.box = null; p.file = ''; SEL.note = ''; ctx.afterChange(true); } return undefined; }
    if (name === 'masksFindWords') { const p = part(); if (p && p.kind === 'words' && SEL.words) { p.text = String(SEL.words.value || '').trim().slice(0, 40); SEL.note = ''; void find(p); } return undefined; }
    if (name === 'masksRemovePart') { const j = Number(args[0]); if (m.parts.length > 1 && m.parts[j]) { m.parts.splice(j, 1); S.part = Math.min(S.part, m.parts.length - 1); ctx.afterChange(true); } return undefined; }
    if (name === 'masksLook') { const l = MO_MASK_LOOKS.find((x) => x[0] === args[0]); if (l) { for (const [k] of MO_MASK_ADJUST) m.adjust[k] = 0; Object.assign(m.adjust, l[2]); ctx.afterChange(true); } return undefined; }
    if (name === 'masksReset') { for (const [k] of MO_MASK_ADJUST) m.adjust[k] = 0; return ctx.afterChange(true); }
    return undefined;
  }
  open.set(me, { act: (name, ...args) => act(name, ...args) });

  return {
    panel,
    sync,
    /** The selected mask's id for Show Mask, when the tool is showing (after it is sent to the engine). */
    tint(engine) { const m = cur(); if (!m || !S.overlay || !ctx.on()) return null; const ps = ctx.photoSize(); return moMaskEnsure(engine, m, ps.w, ps.h); },
    /** The selected mask, for Show Mask, when the tool is showing. */
    tintMask() { const m = cur(); return m && S.overlay && ctx.on() ? m : null; },
    dispose() {
      open.delete(me);
      for (const d of handleDisposers.splice(0)) { try { d.dispose(); } catch { /* gone */ } }
      for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } }
      layer.remove();
    },
  };
}
