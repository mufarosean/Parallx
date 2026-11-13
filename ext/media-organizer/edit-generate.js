// edit-generate.js — the Image Editor's Generate tab: change a marked part of
// a photo by a written instruction, with a model that runs on this computer
// (generate-engine.js, engine/generate.py).
//
// Three steps, in the panel's order: mark the area (brush over it, the
// subject, or the whole picture), say what to do there, pick a result.
//
// The photo itself is never handed to the model and never taken back from it.
// The area around the mark is cut out at the photo's own pixels and handed to
// the engine with the mark; the engine shows the model a smaller picture of
// it, holds everything outside the mark still while the model works, and
// gives back only the marked part, as a patch at the photo's own pixels (how,
// and why, is in engine/generate.py). A kept patch is stored the way Remove
// stores its patches, so undo, the history, hiding it and saving all work on
// it as they do on a removal.
//
// A patch at the photo's own pixels can be large (the whole picture is one
// patch the size of the photo), so each try is shown from a small copy the
// engine writes beside it, and the full one is read only for the try being
// looked at and for Keep.

import { moEl } from './dom.js';
import { moPointKeys } from './keys.js';
import { moSelectState, moSelector } from './edit-select.js';
import { moGenerateDownloadBytes, moGenerateRun, moGenerateSetUp, moGenerateStatus, moGenerateStop, moGenerateStopSetUp } from './generate-engine.js';

const TRIES = 3;
/** Free graphics memory a run needs, in MiB (engine/generate.py refuses below 21 GB). */
export const MO_GENERATE_NEEDS_MIB = 21 * 1024;

/** The card with the most memory, as { free, total } in MiB, from the engine's check; null when there is none. */
export function moGenCardRoom(machine) {
  const card = ((machine && machine.cards) || []).slice().sort((a, b) => b.vramMiB - a.vramMiB)[0];
  return card ? { free: card.freeMiB, total: card.vramMiB, name: card.name } : null;
}
/** Ready-made starts for the instruction: [label, text]. */
export const MO_GENERATE_STARTS = [
  ['Remove It', 'Remove what is marked. Leave only what surrounds it, continued naturally.', 'eraser'],
  ['Replace With', 'Replace what is marked with ', 'replace'],
  ['Change The Sky', 'Change the sky to ', 'cloud'],
  ['Continue The Scene', 'Continue the scene naturally into the marked area.', 'expand'],
];

// Every button runs a declared command, sent to the editor it belongs to (the first argument).
const ACTIONS = ['generateWay', 'generateClear', 'generateStart', 'generateGo', 'generateMore', 'generateKeep', 'generatePick', 'generateStop', 'generateSetUp', 'generateStopSetUp', 'generateCheck', 'generateAside'];
const open = new Map();
let seq = 0;

/** The tab's commands, registered while the extension is on. */
export function moEditGenerateActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.${a}`, (who, ...args) => { const p = open.get(who); return p ? p.act(a, ...args) : undefined; }));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const grey = (v) => `rgb(${[v, v, v].join(', ')})`; // a mask's pixels are data, built from numbers: white is what may change

/**
 * The area the model sees for a mark's box: the mark and half as much again on each side, inside the photo
 * (engine/generate_patch.py has the same rule, for a picture it is handed whole). Close enough in that the
 * marked thing is most of what the model looks at, far enough out that it sees what it must join to.
 */
export function moGenCutOut(box, W, H) {
  let px = Math.max(256, Math.floor(box.w / 2)), py = Math.max(256, Math.floor(box.h / 2));
  if (box.w >= W * 0.9) { px = 0; py = Math.max(256, Math.floor(box.h * 0.35)); }
  if (box.h >= H * 0.9) { px = Math.max(256, Math.floor(box.w * 0.35)); py = 0; }
  const x0 = Math.max(0, box.x - px), y0 = Math.max(0, box.y - py), x1 = Math.min(W, box.x + box.w + px), y1 = Math.min(H, box.y + box.h + py);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The box round brush strokes ({ pts: [[x, y]…], r } in photo pixels), inside the photo; null when nothing is marked. */
export function moGenStrokesBox(strokes, W, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.pts) { x0 = Math.min(x0, x - s.r); y0 = Math.min(y0, y - s.r); x1 = Math.max(x1, x + s.r); y1 = Math.max(y1, y + s.r); }
  if (!Number.isFinite(x0)) return null;
  x0 = clamp(Math.floor(x0), 0, W); y0 = clamp(Math.floor(y0), 0, H); x1 = clamp(Math.ceil(x1), 0, W); y1 = clamp(Math.ceil(y1), 0, H);
  return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Where a try's box ([x0, y0, x1, y1] in the piece that was cut out at `cut`) sits in the photo. */
export function moGenPatchBox(tryBox, cut) {
  return { x: cut.x + tryBox[0], y: cut.y + tryBox[1], w: tryBox[2] - tryBox[0], h: tryBox[3] - tryBox[1] };
}

const gb = (bytes) => `${Math.round(bytes / 1024 ** 3)} GB`;
const canvasPng = async (cv) => new Uint8Array(await (await new Promise((res) => cv.toBlob(res, 'image/png'))).arrayBuffer());

/**
 * ctx: { api, host (the element over the picture), on() -> the tab is showing,
 *   idStem, photoSize() -> { w, h }, picture() -> the photo as it stands (a canvas or bitmap, its own pixels),
 *   toScreen(u, v) -> { x, y } in host pixels, fromScreen(clientX, clientY) -> { u, v },
 *   screenPerPhoto() -> screen pixels per photo pixel, select (the model runner for Select Subject, or null),
 *   workDir() -> a folder for this photo's jobs (or null with no workspace), writeBytes(path, bytes), readBytes(path),
 *   keep(patchBytes, box, info) -> stores the patch and records it, rerender() }.
 * Returns { panel(body, disposers), sync(), dispose() }.
 */
export function moEditGenerate(ctx) {
  const { api } = ctx;
  const ui = api.ui;
  const id = (s) => `${ctx.idStem}.${s}`;
  const G = { way: 'brush', strokes: [], subject: null, brush: 120, text: '', running: null, error: '', tries: [], pick: 0, seed: 42, told: null, engine: null, setUp: null, note: '', card: null };
  const me = `generate-${++seq}`;
  const disposers = [];
  const sep = () => ((ctx.workDir() || '').includes('\\') ? '\\' : '/');

  // ── the mark ──
  const size = () => ctx.photoSize();
  function markBox() {
    const { w, h } = size();
    if (G.way === 'whole') return { x: 0, y: 0, w, h };
    if (G.way === 'subject') return G.subject ? G.subject.box : null;
    return moGenStrokesBox(G.strokes, w, h);
  }
  /** The mark as a canvas the size of `cut`: white where the model may change the picture. */
  function markCanvas(cut) {
    const cv = moEl('canvas'); cv.width = cut.w; cv.height = cut.h;
    const g = cv.getContext('2d');
    g.fillStyle = grey(0); g.fillRect(0, 0, cut.w, cut.h);
    g.translate(-cut.x, -cut.y);
    g.fillStyle = grey(255); g.strokeStyle = grey(255); g.lineCap = 'round'; g.lineJoin = 'round';
    if (G.way === 'whole') g.fillRect(cut.x, cut.y, cut.w, cut.h);
    else if (G.way === 'subject' && G.subject) g.drawImage(G.subject.canvas, 0, 0, size().w, size().h);
    else for (const s of G.strokes) {
      g.lineWidth = s.r * 2; g.beginPath();
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (s.pts.length === 1) { g.arc(s.pts[0][0], s.pts[0][1], s.r, 0, Math.PI * 2); g.fill(); } else g.stroke();
    }
    return cv;
  }
  const marked = () => !!markBox();
  const clearMark = () => { G.strokes = []; G.subject = null; dropTries(); };

  async function selectSubject() {
    G.way = 'subject'; G.subject = null; G.note = '';
    const bridge = ctx.select && ctx.select.bridge;
    const st = await moSelectState(bridge, 'subject').catch(() => null);
    if (!bridge || !st || st.state !== 'ready') { G.note = 'Select Subject uses the model the Masks tab sets up. Set it up there, then come back.'; G.way = 'brush'; ctx.rerender(); return; }
    G.note = 'Finding the subject'; ctx.rerender();
    try {
      const field = await moSelector(bridge, ctx.select.image()).subject();
      const cv = moEl('canvas'); cv.width = field.w; cv.height = field.h;
      const d = new Uint8ClampedArray(field.w * field.h * 4);
      let x0 = field.w, y0 = field.h, x1 = -1, y1 = -1;
      for (let i = 0; i < field.w * field.h; i++) {
        const on = field.a[i] >= 0.5; const v = on ? 255 : 0;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
        if (on) { const x = i % field.w, y = (i / field.w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      cv.getContext('2d').putImageData(new ImageData(d, field.w, field.h), 0, 0);
      if (x1 < 0) { G.note = 'No subject was found. Brush over the area instead.'; G.way = 'brush'; }
      else {
        const { w, h } = size(); const kx = w / field.w, ky = h / field.h;
        G.subject = { canvas: cv, box: { x: Math.floor(x0 * kx), y: Math.floor(y0 * ky), w: Math.ceil((x1 - x0 + 1) * kx), h: Math.ceil((y1 - y0 + 1) * ky) } };
        G.note = '';
      }
    } catch (err) { G.note = `The subject could not be found: ${(err && err.message) || err}`; G.way = 'brush'; }
    dropTries(); ctx.rerender(); sync();
  }

  // ── on the picture: the brush, what is marked, and a try shown in place ──
  const layer = moEl('div', 'mo-gen-layer mo-hidden');
  const ink = moEl('canvas', 'mo-gen-ink', { 'aria-hidden': 'true' });
  const shown = moEl('img', 'mo-gen-try mo-hidden', { alt: '' });
  const cursor = moEl('div', 'mo-gen-cursor mo-hidden', { 'aria-hidden': 'true' });
  layer.append(shown, ink, cursor);
  ctx.host.appendChild(layer);
  disposers.push(() => layer.remove());
  let stroke = null, keyPoint = null;
  const photoR = () => (G.brush / 2) / Math.max(1e-6, ctx.screenPerPhoto());
  const at = (e) => { const { w, h } = size(); const q = ctx.fromScreen(e.clientX, e.clientY); return [clamp(q.u, 0, 1) * w, clamp(q.v, 0, 1) * h]; };
  const ready = () => !!G.engine && G.engine.state === 'ready' && !G.setUp; // nothing is marked on the photo before the engine is set up
  const brushing = () => ctx.on() && ready() && G.way === 'brush' && !G.running;
  const press = ui.onDragPress(layer, (e) => {
    if (!brushing() || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation(); // the stage must not start a pan under the brush
    stroke = { pts: [at(e)], r: photoR() };
    G.strokes.push(stroke); dropTries();
    try { layer.setPointerCapture(e.pointerId); } catch { /* the press is gone */ }
    sync();
  }, { pointerEvents: true });
  disposers.push(() => press.dispose());
  const onMove = (e) => {
    if (brushing()) { const r = ctx.host.getBoundingClientRect(); Object.assign(cursor.style, { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px`, width: `${G.brush}px`, height: `${G.brush}px` }); cursor.classList.remove('mo-hidden'); }
    if (!stroke) return;
    stroke.pts.push(at(e)); sync();
  };
  const onUp = () => { if (!stroke) return; stroke = null; ctx.rerender(); };
  layer.addEventListener('pointermove', onMove);
  layer.addEventListener('pointerup', onUp);
  layer.addEventListener('pointercancel', onUp);
  layer.addEventListener('pointerleave', () => cursor.classList.add('mo-hidden'));
  disposers.push(moPointKeys(layer, 'Photo. Arrow keys move the brush, Enter or Space marks where it is.', {
    move: (dx, dy) => { keyPoint = keyPoint || { u: 0.5, v: 0.5 }; keyPoint = { u: clamp(keyPoint.u + dx * 0.01, 0, 1), v: clamp(keyPoint.v + dy * 0.01, 0, 1) }; sync(); },
    take: () => { if (!brushing()) return; keyPoint = keyPoint || { u: 0.5, v: 0.5 }; const { w, h } = size(); G.strokes.push({ pts: [[keyPoint.u * w, keyPoint.v * h]], r: photoR() }); dropTries(); ctx.rerender(); sync(); },
  }));

  /** Redraw what is over the picture: the mark, the keyboard's brush, the try being looked at. */
  function sync() {
    const live = ctx.on();
    layer.classList.toggle('mo-hidden', !live);
    if (!live) return;
    layer.classList.toggle('is-brush', brushing());
    const r = ctx.host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (ink.width !== Math.round(r.width * dpr) || ink.height !== Math.round(r.height * dpr)) { ink.width = Math.round(r.width * dpr); ink.height = Math.round(r.height * dpr); }
    const g = ink.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const { w, h } = size();
    const tint = getComputedStyle(layer).getPropertyValue('--mo-gen-tint').trim() || grey(255);
    const scr = (x, y) => ctx.toScreen(x / w, y / h);
    const t = G.tries[G.pick];
    if (!t) {
      g.globalAlpha = 0.45; g.fillStyle = tint; g.strokeStyle = tint; g.lineCap = 'round'; g.lineJoin = 'round';
      if (G.way === 'brush') for (const s of G.strokes) {
        const k = ctx.screenPerPhoto();
        g.lineWidth = s.r * 2 * k; g.beginPath();
        s.pts.forEach(([x, y], i) => { const p = scr(x, y); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
        if (s.pts.length === 1) { const p = scr(s.pts[0][0], s.pts[0][1]); g.arc(p.x, p.y, s.r * k, 0, Math.PI * 2); g.fill(); } else g.stroke();
      } else { const b = markBox(); if (b) { const a = scr(b.x, b.y), c = scr(b.x + b.w, b.y + b.h); g.globalAlpha = 0.22; g.fillRect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y)); } }
      g.globalAlpha = 1;
    }
    if (keyPoint && brushing()) { const p = ctx.toScreen(keyPoint.u, keyPoint.v); g.strokeStyle = tint; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, G.brush / 2, 0, Math.PI * 2); g.stroke(); }
    // The try being looked at, laid where it will go: an affine map from its box's three corners.
    shown.classList.toggle('mo-hidden', !t);
    if (t) {
      const o = scr(t.box.x, t.box.y), px = scr(t.box.x + t.box.w, t.box.y), py = scr(t.box.x, t.box.y + t.box.h);
      const src = t.full ? t.full.url : t.url; // the small copy until the full one is read
      if (shown.src !== src) shown.src = src;
      Object.assign(shown.style, { width: `${t.pw}px`, height: `${t.ph}px`, transform: `matrix(${(px.x - o.x) / t.pw}, ${(px.y - o.y) / t.pw}, ${(py.x - o.x) / t.ph}, ${(py.y - o.y) / t.ph}, ${o.x}, ${o.y})` });
    }
  }

  // ── the engine ──
  async function checkEngine() {
    G.engine = await moGenerateStatus().catch(() => ({ state: 'absent', installing: false, machine: { ok: false, problems: ['The engine could not be checked.'] } }));
    if (ctx.on()) { ctx.rerender(); sync(); }
  }
  async function setUp() {
    G.setUp = { label: 'Starting', fraction: 0, error: '' }; G.card = null;
    ctx.rerender();
    const r = await moGenerateSetUp((step) => { if (!G.setUp) return; G.setUp.label = step.label; G.setUp.fraction = step.fraction; G.setUp.bytes = step.total ? `${gb(step.received || 0)} of ${gb(step.total)}` : ''; if (ctx.on()) ctx.rerender(); });
    G.setUp = r.ok ? null : { error: r.error || 'Setting up stopped.' };
    // The last step is a test edit on the card. When that is what failed and the card is full, the panel offers the way through.
    if (!r.ok && /self-test/i.test(r.error || '') && !(await roomOnCard())) G.card.setUp = true; else G.card = null;
    await checkEngine();
  }

  function dropTries() {
    for (const t of G.tries) { URL.revokeObjectURL(t.url); if (t.full) URL.revokeObjectURL(t.full.url); }
    G.tries = []; G.pick = 0; G.told = null;
  }
  /** The try being looked at, at the photo's own pixels: read when it is picked, and the one before it let go. */
  async function readFull(t) {
    for (const o of G.tries) if (o !== t && o.full) { URL.revokeObjectURL(o.full.url); o.full = null; }
    if (!t || t.full || t.reading) return;
    t.reading = true;
    try {
      const bytes = await ctx.readBytes(t.file);
      if (G.tries[G.pick] === t) { t.full = { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) }; sync(); }
    } catch { /* the small copy stays on the photo; Keep reads the file again and says so if it cannot */ }
    t.reading = false;
  }

  /** Is there room on the card? When there is not, G.card says how much there is, for the panel to show. */
  async function roomOnCard() {
    const st = await moGenerateStatus().catch(() => null);
    const room = moGenCardRoom(st && st.machine);
    G.card = room && room.free < MO_GENERATE_NEEDS_MIB ? Object.assign(room, { more: G.card ? G.card.more : false }) : null;
    return !G.card;
  }
  /** His click: the local chat models leave the card, then the run starts. */
  async function setAsideAndGenerate() {
    if (!G.card || G.running) return;
    const more = !!G.card.more, forSetUp = !!G.card.setUp;
    G.card.busy = true; ctx.rerender();
    try { if (api.lm && api.lm.releaseLocalModels) await api.lm.releaseLocalModels(); } catch { /* the check below says what is left */ }
    await new Promise((res) => setTimeout(res, 1500)); // the engine gives the memory back a moment after it answers
    if (await roomOnCard()) { if (forSetUp) void setUp(); else void generate(more, true); return; }
    G.card.stuck = true; G.card.setUp = forSetUp; ctx.rerender();
  }

  async function generate(more, checked) {
    const box = markBox();
    const dir = ctx.workDir();
    if (!box || G.running) return;
    if (!dir) { G.error = 'Generate needs an open workspace to keep its patches in.'; ctx.rerender(); return; }
    if (!checked) { G.card = null; if (!(await roomOnCard())) { G.card.more = !!more; G.error = ''; ctx.rerender(); return; } }
    if (!more) { dropTries(); G.seed = 42; }
    const told = G.told;
    G.error = ''; G.running = { label: 'Cutting out the area', fraction: 0, runId: null };
    ctx.rerender(); sync();
    try {
      const { w, h } = size();
      const cut = moGenCutOut(box, w, h);
      const piece = moEl('canvas'); piece.width = cut.w; piece.height = cut.h;
      piece.getContext('2d').drawImage(ctx.picture(), cut.x, cut.y, cut.w, cut.h, 0, 0, cut.w, cut.h);
      const job = `${dir}${sep()}generate-${Date.now().toString(36)}`;
      const p = (name) => `${job}${sep()}${name}`;
      await ctx.writeBytes(p('in.png'), await canvasPng(piece));
      await ctx.writeBytes(p('mask.png'), await canvasPng(markCanvas(cut)));
      // More tries of the same mark and words go to the model with the instruction it was given the first time.
      const again = more && told && told.by === 'engine' && told.from === G.text.trim() ? told.prompt : '';
      const instruction = again || G.text.trim() || MO_GENERATE_STARTS[0][1];
      await ctx.writeBytes(p('job.json'), new TextEncoder().encode(JSON.stringify({ input: p('in.png'), mask: p('mask.png'), instruction, output: p('out'), steps: 40, seed: G.seed, tries: TRIES, cut_out: false, write_prompt: !again })));
      const result = await moGenerateRun(p('job.json'), (step) => { if (!G.running) return; G.running.label = step.label; G.running.fraction = step.fraction; if (G.running.bar) { G.running.bar(step); } else if (ctx.on()) ctx.rerender(); }, { onRunId: (runId) => { if (G.running) G.running.runId = runId; } });
      for (const t of result.tries) {
        const file = `${p('out')}${sep()}${t.file}`;
        const bytes = await ctx.readBytes(t.small ? `${p('out')}${sep()}${t.small}` : file);
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        G.tries.push({ file, full: null, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), box: moGenPatchBox(t.box, cut), pw: bmp.width, ph: bmp.height, seed: t.seed, seconds: t.seconds });
        bmp.close();
      }
      G.told = again ? told : { prompt: result.prompt || '', by: result.promptBy || 'instruction', note: result.note || '', from: G.text.trim() };
      G.seed += TRIES;
      G.pick = Math.max(0, G.tries.length - result.tries.length);
      void readFull(G.tries[G.pick]);
    } catch (err) {
      if (!(err && err.stopped)) G.error = (err && err.message) || String(err);
    }
    G.running = null;
    ctx.rerender(); sync();
  }

  async function keep() {
    const t = G.tries[G.pick];
    if (!t) return;
    try { await ctx.keep(t.full ? t.full.bytes : await ctx.readBytes(t.file), t.box, { instruction: G.text.trim(), seed: t.seed }); } catch (err) { G.error = `It could not be kept: ${(err && err.message) || err}`; ctx.rerender(); return; }
    clearMark(); G.text = ''; G.way = 'brush';
    ctx.rerender(); sync();
  }

  // ── what each command does ──
  let textEl = null;
  function act(name, arg) {
    if (name === 'generateWay') { if (arg === 'subject') { void selectSubject(); return; } if (arg !== 'brush' && arg !== 'whole') return; G.way = arg; G.note = ''; dropTries(); ctx.rerender(); sync(); }
    else if (name === 'generateClear') { clearMark(); ctx.rerender(); sync(); }
    else if (name === 'generateStart') { const start = MO_GENERATE_STARTS[arg]; if (!start) return; G.text = start[1]; if (textEl && textEl.isConnected) { textEl.value = G.text; textEl.focus(); textEl.setSelectionRange(G.text.length, G.text.length); } }
    else if (name === 'generateGo') void generate(false);
    else if (name === 'generateMore') void generate(true);
    else if (name === 'generateKeep') void keep();
    else if (name === 'generatePick') { if (!G.tries[arg]) return; G.pick = arg; ctx.rerender(); sync(); void readFull(G.tries[arg]); }
    else if (name === 'generateStop') void moGenerateStop(G.running && G.running.runId);
    else if (name === 'generateSetUp') void setUp();
    else if (name === 'generateStopSetUp') void moGenerateStopSetUp();
    else if (name === 'generateCheck') void checkEngine();
    else if (name === 'generateAside') void setAsideAndGenerate();
  }
  open.set(me, { act });
  disposers.push(() => open.delete(me));

  // ── the panel ──
  const button = (parent, key, label, icon, action, args = [], o = {}) => ui.createButton(parent, Object.assign({ id: id(key), label, icon, size: 'sm', command: `media-organizer.${action}`, args: [me, ...args] }, o));
  const stepHead = (parent, n, title, done) => {
    const head = moEl('div', 'mo-gen-step-head');
    head.append(moEl('span', 'mo-gen-step-n' + (done ? ' is-done' : ''), { textContent: String(n), 'aria-hidden': 'true' }), moEl('span', 'mo-gen-step-title', { textContent: title }));
    parent.appendChild(head);
    return head;
  };

  /** The card is in use: what is on it, and the one button that makes room. */
  function cardInUse(parent, label) {
    const gbOf = (mib) => `${Math.round(mib / 1024)} GB`;
    const used = Math.max(0, G.card.total - G.card.free);
    const box = moEl('div', 'mo-gen-card', { role: 'group', 'aria-label': 'The graphics card is in use' });
    box.appendChild(moEl('div', 'mo-gen-running', { textContent: 'The graphics card is in use' }));
    box.appendChild(moEl('p', 'mo-gen-dim', { textContent: `Generate needs about ${gbOf(MO_GENERATE_NEEDS_MIB)} free. ${gbOf(G.card.free)} of ${gbOf(G.card.total)} is free.` }));
    const meter = moEl('div', 'mo-gen-meter', { role: 'img', 'aria-label': `${gbOf(used)} of ${gbOf(G.card.total)} of graphics memory is in use` });
    const fill = moEl('div', 'mo-gen-meter-fill'); fill.style.width = `${Math.round((used / Math.max(1, G.card.total)) * 100)}%`;
    meter.appendChild(fill); box.appendChild(meter);
    if (G.card.stuck) box.appendChild(moEl('p', 'mo-gen-error', { role: 'alert', textContent: 'The chat model is set aside, and there is still not enough free. Something else is using the graphics card.' }));
    const aside = button(box, 'aside', label, 'sparkles', 'generateAside', [], { kind: 'primary' });
    aside.classList.add('mo-gen-go'); aside.disabled = !!G.card.busy;
    box.appendChild(moEl('p', 'mo-gen-dim', { textContent: 'The chat model comes back by itself on your next message. Nothing in the chat is lost.' }));
    parent.appendChild(box);
  }

  function engineCard(body) {
    const card = moEl('div', 'mo-edit-setup');
    const m = (G.engine && G.engine.machine) || { ok: false, problems: [] };
    if (G.setUp && !G.setUp.error) {
      card.append(moEl('div', 'mo-edit-setup-title', { textContent: 'Setting up Generate' }), moEl('p', null, { textContent: G.setUp.label || 'Working', 'aria-live': 'polite' }));
      const bar = moEl('div', 'mo-edit-progress', { role: 'progressbar', 'aria-label': 'Setting up Generate', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((G.setUp.fraction || 0) * 100)) });
      const fill = moEl('div', 'mo-edit-progress-fill'); fill.style.width = `${Math.round((G.setUp.fraction || 0) * 100)}%`;
      bar.appendChild(fill); card.appendChild(bar);
      if (G.setUp.bytes) card.appendChild(moEl('p', 'mo-gen-dim', { textContent: G.setUp.bytes }));
      card.appendChild(moEl('p', null, { textContent: 'You can keep working. Stopping keeps what is done; setting up again carries on from there.' }));
      button(card, 'stopSetUp', 'Stop', 'square', 'generateStopSetUp');
    } else if (!m.ok) {
      card.append(moEl('div', 'mo-edit-setup-title', { textContent: 'Generate cannot run on this computer' }));
      for (const p of m.problems || []) card.appendChild(moEl('p', null, { textContent: p }));
      button(card, 'checkAgain', 'Check Again', 'refresh-cw', 'generateCheck');
    } else if (G.card && G.card.setUp) {
      card.append(moEl('div', 'mo-edit-setup-title', { textContent: 'One step left' }),
        moEl('p', null, { textContent: 'Everything is downloaded. The last step is a test edit, and it needs the graphics card.' }));
      cardInUse(card, 'Set The Chat Model Aside And Finish');
    } else {
      card.append(moEl('div', 'mo-edit-setup-title', { textContent: 'Set up Generate' }),
        moEl('p', null, { textContent: 'It changes part of a photo from a written instruction, on this computer. Your photos never leave it.' }),
        moEl('p', null, { textContent: `It downloads about ${gb(moGenerateDownloadBytes())} once, for every workspace.` }));
      if (G.engine && G.engine.state === 'partial') card.appendChild(moEl('p', null, { textContent: 'Setting up stopped part of the way. It carries on from where it stopped.' }));
      if (G.setUp && G.setUp.error) card.appendChild(moEl('p', 'mo-gen-error', { role: 'alert', textContent: G.setUp.error }));
      button(card, 'setUp', G.engine && G.engine.state === 'partial' ? 'Carry On Setting Up' : 'Set Up Generate', 'download', 'generateSetUp', [], { kind: 'primary' });
    }
    body.appendChild(card);
  }

  function panel(body) {
    if (!G.engine) { body.appendChild(moEl('p', 'mo-gen-dim mo-gen-pad', { textContent: 'Checking' })); void checkEngine(); return; }
    if (G.engine.state !== 'ready' || G.setUp) { engineCard(body); return; }

    // 1. Mark the area
    const one = moEl('div', 'mo-gen-step');
    const h1 = stepHead(one, 1, 'Mark the area', marked());
    if (marked()) h1.appendChild(moEl('span', 'mo-gen-ok', { textContent: 'Marked' }));
    const ways = moEl('div', 'mo-gen-ways', { role: 'group', 'aria-label': 'How to mark the area' });
    for (const [key, label, icon] of [['brush', 'Brush Over It', 'paintbrush'], ['subject', 'Select Subject', 'user-round'], ['whole', 'Whole Picture', 'image']]) {
      const b = button(ways, `way.${key}`, label, icon, 'generateWay', [key]);
      b.classList.toggle('is-on', G.way === key);
      b.setAttribute('aria-pressed', G.way === key ? 'true' : 'false');
    }
    one.appendChild(ways);
    if (G.way === 'brush') {
      const row = moEl('div', 'mo-gen-row');
      const range = moEl('input', 'mo-edit-range', { type: 'range', min: '8', max: '400', step: '1', 'aria-label': 'Brush size', sceneId: id('brush'), sceneLabel: 'Brush size' });
      range.value = String(G.brush);
      const val = moEl('span', 'mo-gen-val', { textContent: `${G.brush} px` });
      range.addEventListener('input', () => { G.brush = Number(range.value); val.textContent = `${G.brush} px`; });
      row.append(moEl('span', 'mo-gen-dim', { textContent: 'Brush' }), range, val);
      one.appendChild(row);
      if (G.strokes.length) button(one, 'clear', 'Clear The Mark', 'eraser', 'generateClear', [], { kind: 'ghost' });
    }
    if (G.note) one.appendChild(moEl('p', 'mo-gen-dim', { textContent: G.note, 'aria-live': 'polite' }));
    body.appendChild(one);

    // 2. Say what to do there
    const two = moEl('div', 'mo-gen-step');
    stepHead(two, 2, 'Say what to do there', G.tries.length > 0);
    const text = moEl('textarea', 'mo-gen-text', { rows: '3', 'aria-label': 'What to do in the marked area', placeholder: 'Replace the hay bale with a small red tractor', sceneId: id('instruction'), sceneLabel: 'What to do in the marked area' });
    text.value = G.text;
    text.addEventListener('input', () => { G.text = text.value; });
    two.appendChild(text);
    const starts = moEl('div', 'mo-gen-starts');
    MO_GENERATE_STARTS.forEach(([label, , icon], i) => button(starts, `start.${i + 1}`, label, icon, 'generateStart', [i], { kind: 'ghost' }));
    textEl = text;
    two.appendChild(starts);
    if (G.running) {
      const label = moEl('p', 'mo-gen-running', { textContent: G.running.label, 'aria-live': 'polite' });
      const bar = moEl('div', 'mo-edit-progress', { role: 'progressbar', 'aria-label': 'Generating', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(G.running.fraction * 100)) });
      const fill = moEl('div', 'mo-edit-progress-fill'); fill.style.width = `${Math.round(G.running.fraction * 100)}%`;
      bar.appendChild(fill);
      // Progress moves these in place: a rebuilt panel would take the focus from Stop.
      G.running.bar = (step) => { label.textContent = step.label; fill.style.width = `${Math.round(step.fraction * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round(step.fraction * 100))); };
      two.append(label, bar);
      const row = moEl('div', 'mo-gen-row');
      row.appendChild(moEl('span', 'mo-gen-dim', { textContent: 'You can keep editing this photo.' }));
      button(row, 'stop', 'Stop', 'square', 'generateStop');
      two.appendChild(row);
    } else if (G.card) {
      cardInUse(two, 'Set The Chat Model Aside And Generate');
    } else {
      const go = button(two, 'generate', `Generate ${TRIES} Tries`, 'sparkles', 'generateGo', [], { kind: 'primary' });
      go.disabled = !marked();
      go.classList.add('mo-gen-go');
      if (!marked()) two.appendChild(moEl('p', 'mo-gen-dim', { textContent: 'Mark an area first.' }));
    }
    if (G.error) two.appendChild(moEl('p', 'mo-gen-error', { role: 'alert', textContent: G.error }));
    body.appendChild(two);

    // 3. Pick a result
    const three = moEl('div', 'mo-gen-step');
    stepHead(three, 3, 'Pick a result', false);
    if (!G.tries.length) three.appendChild(moEl('p', 'mo-gen-dim', { textContent: 'The tries appear here. Choose one to see it on the photo.' }));
    else {
      const strip = moEl('div', 'mo-gen-tries', { role: 'group', 'aria-label': 'Tries' });
      G.tries.forEach((t, i) => {
        const b = button(strip, `try.${i + 1}`, `Try ${i + 1}`, 'image', 'generatePick', [i]);
        b.classList.add('mo-gen-thumb'); b.classList.toggle('is-on', i === G.pick);
        b.setAttribute('aria-pressed', i === G.pick ? 'true' : 'false');
        b.appendChild(moEl('img', null, { src: t.url, alt: '' }));
      });
      three.appendChild(strip);
      const row = moEl('div', 'mo-gen-row');
      const more = button(row, 'more', 'More Tries', 'plus', 'generateMore');
      more.disabled = !!G.running;
      button(row, 'keep', 'Keep', 'check', 'generateKeep', [], { kind: 'primary' });
      three.appendChild(row);
      // What the model was given: his words written out by the engine, which is shown where the mark is.
      if (G.told && G.told.by === 'engine' && G.told.prompt) three.appendChild(moEl('p', 'mo-gen-dim', { textContent: `Written out for the model: ${G.told.prompt}` }));
      else if (G.told && G.told.note) three.appendChild(moEl('p', 'mo-gen-dim', { textContent: 'Your words went to the model as you wrote them; the engine could not write them out.' }));
    }
    three.appendChild(moEl('p', 'mo-gen-dim', { textContent: 'The original is never changed. A kept result is a patch you can undo, hide or delete.' }));
    body.appendChild(three);
  }

  return {
    panel,
    sync,
    /** A new photo: nothing is marked, nothing is waiting to be picked. */
    reset: () => { clearMark(); G.text = ''; G.error = ''; G.note = ''; G.way = 'brush'; G.card = null; keyPoint = null; sync(); },
    dispose: () => { dropTries(); for (const d of disposers.splice(0)) { try { d(); } catch { /* gone */ } } },
  };
}
