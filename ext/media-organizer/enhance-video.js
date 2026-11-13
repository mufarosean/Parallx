// enhance-video.js — Enhance for a video or a GIF in the library: every frame
// enlarged twice over by the engine photos use (enhance-engine.js; the script
// is engine/enhance_video.py). The result is a new file beside the original,
// with the original's sound, tags, albums, rating and details; the original
// is never changed.
//
// One dialog: what the clip is and what it becomes, how long it will take on
// this graphics card, a three-second preview with the original beside it, and
// the run itself with its progress. A stopped run keeps its frames in a work
// folder in the workspace, so Enhance on the same clip carries on from there.
//
// The model takes most of a large graphics card, so before a run the dialog
// reads the card's free memory; with too little it shows the numbers and
// offers to set the chat model aside (the core's releaseLocalModels, only on
// that click).

import { moEl } from './dom.js';
import { moEnhanceRefresh, moEnhanceStop, moEnhanceVideoPlan, moEnhanceVideoRun } from './enhance-engine.js';

export const MO_ENHANCE_VIDEO_SCALE = 2;
/** Seconds of the clip the preview enlarges. */
export const MO_ENHANCE_VIDEO_PREVIEW_SECONDS = 3;

/** "clip.mov" -> "clip-2x.mp4"; a GIF stays a GIF; n > 1 adds " (n)". */
export function moEnhanceVideoOutputName(basename, scale, n = 1) {
  const dot = basename.lastIndexOf('.');
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext = /\.gif$/i.test(basename) ? 'gif' : 'mp4';
  return `${stem}-${scale}x${n > 1 ? ` (${n})` : ''}.${ext}`;
}

/** The work folder's name for one clip: the same clip, unchanged, gets the same folder, so a stopped run is found again. */
export function moEnhanceVideoWorkName(path, size, mtime, tag = '') {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  const text = `${path}|${size}|${Math.round(Number(mtime) || 0)}|${tag}`;
  for (let i = 0; i < text.length; i++) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0; h2 = Math.imul(h2 + text.charCodeAt(i), 0x9e3779b1) >>> 0; }
  return `.enhance-video-${tag ? `${tag}-` : ''}${h1.toString(36)}${h2.toString(36)}`;
}

/**
 * How long a run takes and how much graphics memory it needs, from what was
 * measured on an RTX 5090 (docs/ENHANCE.md): the time grows with the frames
 * and with the size of each enlarged frame.
 */
export function moEnhanceVideoCost(frames, outWidth, outHeight) {
  const mp = (outWidth * outHeight) / 1e6;
  return { seconds: Math.round(20 + frames * mp * MO_ENHANCE_VIDEO_RATE), needsMiB: mp <= 1.3 ? 22000 : 25000 };
}
/** Seconds for one frame of one megapixel, measured. */
export const MO_ENHANCE_VIDEO_RATE = 0.6;

/** "about 40 seconds", "about 4 minutes", "about 1 hour 10 minutes". */
export function moEnhanceVideoTimeWords(seconds) {
  if (seconds < 90) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minutes`;
  const h = Math.floor(minutes / 60), m = Math.round((minutes % 60) / 5) * 5;
  return `about ${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minutes` : ''}`;
}

// Every button runs a declared command, sent to the dialog it belongs to (the first argument).
const ACTIONS = ['enhanceVideoGo', 'enhanceVideoPreview', 'enhanceVideoStop', 'enhanceVideoClose', 'enhanceVideoStartOver', 'enhanceVideoAside'];
const open = new Map();
let seq = 0;

/** The dialog's commands, registered while the extension is on. */
export function moEnhanceVideoActivate(api) {
  return ACTIONS.map((a) => api.commands.registerCommand(`media-organizer.${a}`, (who) => { const d = open.get(who); return d ? d.act(a) : undefined; }));
}

/**
 * Open the dialog on one clip.
 * target: { path, basename, kind: 'video' | 'gif', size, mtime }.
 * deps: { tools() -> { ffmpeg, ffprobe }, workBase() -> folder in the workspace or null, sep, exists(path),
 *   dispose(paths) -> erases work files the user's way, fileUrl(path) -> a URL the page can play,
 *   finish(outPath) -> takes the result into the library,
 *   showSetUp() -> the engine's set-up dialog }.
 */
export function moEnhanceVideoOpen(api, target, deps) {
  const ui = api.ui;
  const me = `enhance-video-${++seq}`;
  const scale = MO_ENHANCE_VIDEO_SCALE;
  const noun = target.kind === 'gif' ? 'GIF' : 'Video';
  const S = { plan: null, error: '', running: null, note: '', kept: 0, card: null, preview: null, done: false, closed: false };
  const sep = deps.sep;
  const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));
  const workDir = (tag) => { const base = deps.workBase(); return base ? base + sep + moEnhanceVideoWorkName(target.path, target.size, target.mtime, tag) : null; };
  const job = (extra) => Object.assign({ input: target.path, output: '', scale, workDir: workDir(''), ffmpeg: deps.tools().ffmpeg, ffprobe: deps.tools().ffprobe }, extra || {});

  const overlay = moEl('div', 'mo-ev-overlay');
  const dialog = moEl('div', 'mo-ev-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Enhance ${noun}` });
  overlay.appendChild(dialog);
  const button = (parent, key, label, icon, action, o = {}) => ui.createButton(parent, Object.assign({ id: `media-organizer.enhanceVideo.${key}`, label, icon, size: 'sm', command: `media-organizer.${action}`, args: [me] }, o));
  const p = (cls, text, attrs) => moEl('p', cls, Object.assign({ textContent: text }, attrs || {}));

  async function keptFrames() {
    // What a stopped run of this clip left: the frames in its work folder.
    const dir = workDir('');
    if (!dir) return 0;
    try {
      const res = await window.parallxElectron.fs.readdir(dir + sep + 'frames');
      return res && !res.error && Array.isArray(res.entries) ? res.entries.filter((e) => e && /^f_\d{6}\.png$/.test(e.name)).length : 0;
    } catch { return 0; }
  }

  async function read() {
    const tools = deps.tools();
    if (!tools.ffmpeg || !tools.ffprobe) { S.error = 'Enhance for videos needs ffmpeg on this computer, and it was not found.'; render(); return; }
    if (!workDir('')) { S.error = 'Enhance needs an open workspace.'; render(); return; }
    try {
      S.plan = await moEnhanceVideoPlan(job());
      S.kept = await keptFrames();
    } catch (err) { S.error = (err && err.message) || String(err); }
    render();
  }

  /** Is there room on the card for this run? When there is not, S.card says how much there is. */
  async function roomOnCard(needsMiB) {
    const machine = ((await moEnhanceRefresh().catch(() => null)) || {}).machine;
    const card = ((machine && machine.cards) || []).slice().sort((a, b) => b.vramMiB - a.vramMiB)[0];
    S.card = card && card.freeMiB < needsMiB ? { free: card.freeMiB, total: card.vramMiB, needs: needsMiB } : null;
    return !S.card;
  }

  async function outputPath() {
    const dir = dirOf(target.path);
    for (let n = 1; n < 200; n++) {
      const candidate = dir + sep + moEnhanceVideoOutputName(target.basename, scale, n);
      if (!(await deps.exists(candidate))) return candidate;
    }
    throw new Error('A name for the result could not be found.');
  }

  async function run(preview, checked) {
    if (S.running || !S.plan) return;
    const plan = S.plan;
    const frames = preview ? Math.min(plan.frames, Math.round(MO_ENHANCE_VIDEO_PREVIEW_SECONDS * plan.fps)) : plan.frames;
    const cost = moEnhanceVideoCost(frames, plan.width, plan.height);
    S.error = ''; S.note = '';
    if (!checked) { S.card = null; if (!(await roomOnCard(cost.needsMiB))) { S.card.preview = preview; render(); return; } }
    S.running = { label: 'Starting', fraction: 0, runId: null, preview, startedAt: Date.now() };
    render();
    let made = null;
    try {
      if (preview) {
        const dir = workDir('preview');
        const start = Math.max(0, plan.seconds / 2 - MO_ENHANCE_VIDEO_PREVIEW_SECONDS / 2);
        const out = dir + sep + 'preview.mp4';
        await moEnhanceVideoRun(job({ output: out, workDir: dir, start, seconds: MO_ENHANCE_VIDEO_PREVIEW_SECONDS }), progress, { onRunId: (id) => { if (S.running) S.running.runId = id; } });
        S.preview = { after: await deps.fileUrl(out), before: await deps.fileUrl(target.path), start, seconds: Math.min(MO_ENHANCE_VIDEO_PREVIEW_SECONDS, plan.seconds), took: (Date.now() - S.running.startedAt) / 1000 };
      } else {
        made = await outputPath();
        await moEnhanceVideoRun(job({ output: made }), progress, { onRunId: (id) => { if (S.running) S.running.runId = id; } });
        S.running.label = 'Adding it to the library'; if (S.running.bar) S.running.bar(S.running);
        await deps.finish(made);
        dropPreview();
        await finished([workDir(''), workDir('preview')]);
        S.done = true; S.kept = 0;
      }
    } catch (err) {
      if (err && err.stopped) { S.kept = await keptFrames(); S.note = preview ? 'The preview was stopped.' : 'Stopped. What is done is kept: Enhance carries on from there.'; }
      else { S.error = (err && err.message) || String(err); S.kept = await keptFrames(); }
    }
    S.running = null;
    if (S.done) { close(); api.window.showInformationMessage(`Enhanced: ${made.slice(dirOf(made).length + 1)} is beside the original.`); return; }
    render();
  }
  const progress = (step) => { if (!S.running) return; S.running.label = step.label; S.running.fraction = step.fraction; if (S.running.bar) S.running.bar(step); };

  async function setAside() {
    if (!S.card || S.running) return;
    const preview = !!S.card.preview, needs = S.card.needs;
    S.card.busy = true; render();
    try { if (api.lm && api.lm.releaseLocalModels) await api.lm.releaseLocalModels(); } catch { /* the check below says what is left */ }
    await new Promise((res) => setTimeout(res, 1500)); // the engine gives the memory back a moment after it answers
    if (await roomOnCard(needs)) { void run(preview, true); return; }
    S.card.stuck = true; S.card.preview = preview; render();
  }

  /**
   * A work folder that is finished with: its state file goes first, at once, which is what marks the folder as
   * done; then its files are erased the user's way. Eraser, when that is the way, works after this returns, and
   * the folder itself is taken by the next start's sweep (moEnhanceVideoSweep).
   */
  async function finished(dirs) {
    for (const d of dirs) if (d) await window.parallxElectron.fs.delete(d + sep + 'state.json', { useTrash: false }).catch(() => {});
    await deps.dispose(dirs);
  }

  /** Let go of the preview's files: a video being played is held open, and a held file cannot be erased. */
  function dropPreview() {
    for (const v of dialog.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); }
    S.preview = null;
  }

  async function startOver() {
    if (S.running) return;
    await finished([workDir('')]);
    S.kept = 0; S.note = ''; render();
  }

  function close() {
    if (S.closed || (S.running && !S.done)) return;
    S.closed = true;
    open.delete(me);
    tabs.dispose();
    dropPreview();
    overlay.remove();
    // The preview is a copy of the clip: it goes when the dialog does. A stopped run's frames stay, to be carried on.
    void finished([workDir('preview')]);
  }

  function act(name) {
    if (name === 'enhanceVideoGo') void run(false);
    else if (name === 'enhanceVideoPreview') void run(true);
    else if (name === 'enhanceVideoStop') { if (S.running) { S.running.label = 'Stopping'; if (S.running.bar) S.running.bar(S.running); void moEnhanceStop(S.running.runId); } }
    else if (name === 'enhanceVideoClose') close();
    else if (name === 'enhanceVideoStartOver') void startOver();
    else if (name === 'enhanceVideoAside') void setAside();
  }
  open.set(me, { act });

  /** The preview: the enlarged three seconds over the original, a line between them that the slider moves. */
  function compare(parent) {
    const v = S.preview;
    const box = moEl('div', 'mo-ev-compare');
    const before = moEl('video', 'mo-ev-video', { muted: true, playsInline: true, 'aria-label': 'The original' });
    const after = moEl('video', 'mo-ev-video mo-ev-after', { muted: true, playsInline: true, loop: true, autoplay: true, 'aria-label': 'Enhanced' });
    before.muted = true; after.muted = true;
    before.src = v.before; after.src = v.after;
    const line = moEl('div', 'mo-ev-line', { 'aria-hidden': 'true' });
    box.append(before, after, line, moEl('span', 'mo-ev-tag mo-ev-tag-a', { textContent: 'Original' }), moEl('span', 'mo-ev-tag mo-ev-tag-b', { textContent: 'Enhanced' }));
    const place = (pct) => { box.style.setProperty('--mo-ev-at', `${pct}%`); };
    // The original follows the enlarged clip, so both show the same moment.
    const follow = () => { const want = v.start + after.currentTime; if (Math.abs(before.currentTime - want) > 0.12) before.currentTime = want; if (before.paused && !after.paused) void before.play().catch(() => {}); };
    after.addEventListener('timeupdate', follow);
    after.addEventListener('seeked', follow);
    before.addEventListener('loadedmetadata', () => { before.currentTime = v.start; });
    const range = moEl('input', 'mo-edit-range mo-ev-range', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Where the original ends and the enhanced clip begins', sceneId: 'media-organizer.enhanceVideo.compare', sceneLabel: 'Compare' });
    range.value = '50'; place(50);
    range.addEventListener('input', () => place(Number(range.value)));
    parent.append(box, range);
  }

  function cardInUse(parent) {
    const gbOf = (mib) => `${Math.round(mib / 1024)} GB`;
    const used = Math.max(0, S.card.total - S.card.free);
    const box = moEl('div', 'mo-gen-card', { role: 'group', 'aria-label': 'The graphics card is in use' });
    box.appendChild(moEl('div', 'mo-gen-running', { textContent: 'The graphics card is in use' }));
    box.appendChild(p('mo-gen-dim', `This needs about ${gbOf(S.card.needs)} free. ${gbOf(S.card.free)} of ${gbOf(S.card.total)} is free.`));
    const meter = moEl('div', 'mo-gen-meter', { role: 'img', 'aria-label': `${gbOf(used)} of ${gbOf(S.card.total)} of graphics memory is in use` });
    const fill = moEl('div', 'mo-gen-meter-fill'); fill.style.width = `${Math.round((used / Math.max(1, S.card.total)) * 100)}%`;
    meter.appendChild(fill); box.appendChild(meter);
    if (S.card.stuck) box.appendChild(p('mo-gen-error', 'The chat model is set aside, and there is still not enough free. Something else is using the graphics card.', { role: 'alert' }));
    const aside = button(box, 'aside', S.card.preview ? 'Set The Chat Model Aside And Preview' : 'Set The Chat Model Aside And Enhance', 'sparkles', 'enhanceVideoAside', { kind: 'primary' });
    aside.disabled = !!S.card.busy;
    box.appendChild(p('mo-gen-dim', 'The chat model comes back by itself on your next message. Nothing in the chat is lost.'));
    parent.appendChild(box);
  }

  function render() {
    if (S.closed) return;
    const focused = dialog.contains(document.activeElement) ? document.activeElement.getAttribute('data-px-id') : null;
    dialog.replaceChildren();
    dialog.appendChild(moEl('h3', 'mo-ev-title', { textContent: `Enhance ${noun}` }));
    dialog.appendChild(p('mo-ev-name', target.basename));
    const foot = moEl('div', 'mo-ev-foot');
    if (!S.plan && !S.error) {
      dialog.appendChild(p('mo-gen-dim', 'Reading the video', { 'aria-live': 'polite' }));
    } else if (!S.plan) {
      dialog.appendChild(p('mo-gen-error', S.error, { role: 'alert' }));
    } else {
      const plan = S.plan;
      const cost = moEnhanceVideoCost(Math.max(0, plan.frames - S.kept), plan.width, plan.height);
      const facts = moEl('div', 'mo-ev-facts');
      facts.appendChild(p(null, `${plan.width / scale} × ${plan.height / scale} becomes ${plan.width} × ${plan.height}.`));
      facts.appendChild(p('mo-gen-dim', `${plan.seconds < 10 ? Number(plan.seconds.toFixed(1)) : Math.round(plan.seconds)} seconds, ${plan.frames} frames. It takes ${moEnhanceVideoTimeWords(cost.seconds)} on a fast graphics card, and the card is busy while it runs.`));
      facts.appendChild(p('mo-gen-dim', target.kind === 'gif' ? 'The result is a new GIF beside the original. The original is never changed.' : 'The result is a new video beside the original, with its sound. The original is never changed.'));
      dialog.appendChild(facts);
      if (S.preview && !S.running) compare(dialog);
      if (S.running) {
        const label = p('mo-gen-running', S.running.label, { 'aria-live': 'polite' });
        const bar = moEl('div', 'mo-edit-progress', { role: 'progressbar', 'aria-label': S.running.preview ? 'Making the preview' : `Enhancing the ${noun.toLowerCase()}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(S.running.fraction * 100)) });
        const fill = moEl('div', 'mo-edit-progress-fill'); fill.style.width = `${Math.round(S.running.fraction * 100)}%`;
        bar.appendChild(fill);
        // Progress moves these in place: a rebuilt dialog would take the focus from Stop.
        S.running.bar = (step) => { label.textContent = step.label; fill.style.width = `${Math.round((step.fraction || 0) * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round((step.fraction || 0) * 100))); };
        dialog.append(label, bar);
        if (!S.running.preview) dialog.appendChild(p('mo-gen-dim', 'Stop keeps what is done. Enhance on this clip carries on from there.'));
        button(foot, 'stop', 'Stop', 'square', 'enhanceVideoStop');
      } else if (S.card) {
        cardInUse(dialog);
        button(foot, 'close', 'Close', 'x', 'enhanceVideoClose', { kind: 'ghost' });
      } else {
        if (S.kept > 0) {
          const kept = moEl('div', 'mo-ev-kept');
          kept.appendChild(p(null, `A stopped run of this clip is kept: ${Math.min(S.kept, plan.frames)} of ${plan.frames} frames. Enhance carries on from there.`));
          button(kept, 'startOver', 'Start Over', 'refresh-cw', 'enhanceVideoStartOver', { kind: 'ghost' });
          dialog.appendChild(kept);
        }
        if (S.note) dialog.appendChild(p('mo-gen-dim', S.note, { 'aria-live': 'polite' }));
        if (S.error) dialog.appendChild(p('mo-gen-error', S.error, { role: 'alert' }));
        button(foot, 'close', 'Close', 'x', 'enhanceVideoClose', { kind: 'ghost' });
        if (target.kind !== 'gif' && plan.seconds > MO_ENHANCE_VIDEO_PREVIEW_SECONDS + 1) button(foot, 'preview', S.preview ? 'Preview Again' : `Preview ${MO_ENHANCE_VIDEO_PREVIEW_SECONDS} Seconds`, 'eye', 'enhanceVideoPreview');
        button(foot, 'go', S.kept > 0 ? 'Carry On Enhancing' : `Enhance ${noun}`, 'sparkles', 'enhanceVideoGo', { kind: 'primary' });
      }
    }
    if (!foot.childElementCount) button(foot, 'close', 'Close', 'x', 'enhanceVideoClose', { kind: 'ghost' });
    dialog.appendChild(foot);
    const again = focused && dialog.querySelector(`[data-px-id="${focused}"]`);
    (again || foot.querySelector('button.px-btn--primary, button:last-of-type') || foot.querySelector('button')).focus();
  }

  const tabs = ui.keepTabInside(dialog, overlay);
  // Escape closes it, as Close does. While a run is in progress neither does: Stop is the way out.
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.appendChild(overlay);
  render();
  void moEnhanceRefresh().then((engine) => {
    if (engine.status !== 'ready') { S.closed = true; open.delete(me); tabs.dispose(); overlay.remove(); deps.showSetUp(); return; }
    void read();
  });
  return { close };
}

export const MO_ENHANCE_VIDEO_CSS = `
/* Enhance for a video or a GIF: one dialog */
.mo-ev-overlay { position: fixed; inset: 0; z-index: 10005; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--px-bg) 55%, transparent); }
.mo-ev-dialog { width: min(560px, calc(100vw - 2 * var(--px-space-4))); max-height: 86vh; overflow-y: auto; display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-4); background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); box-shadow: var(--px-shadow-lg); color: var(--px-text); }
.mo-ev-title { margin: 0; font-size: var(--px-text-base); font-weight: 600; }
.mo-ev-name { margin: 0; color: var(--px-text-secondary); font-size: var(--px-text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-ev-dialog p { margin: 0; font-size: var(--px-text-sm); line-height: 1.45; }
.mo-ev-facts { display: flex; flex-direction: column; gap: var(--px-space-1); }
.mo-ev-kept { display: flex; align-items: center; gap: var(--px-space-2); justify-content: space-between; padding: var(--px-space-2) 0; border-top: 1px solid var(--px-border); }
.mo-ev-foot { display: flex; justify-content: flex-end; gap: var(--px-space-2); margin-top: var(--px-space-2); }
.mo-ev-compare { position: relative; --mo-ev-at: 50%; border-radius: var(--px-radius-sm); overflow: hidden; background: var(--px-bg); line-height: 0; }
.mo-ev-video { display: block; width: 100%; max-height: 46vh; object-fit: contain; }
.mo-ev-after { position: absolute; inset: 0; height: 100%; clip-path: inset(0 0 0 var(--mo-ev-at)); }
.mo-ev-line { position: absolute; top: 0; bottom: 0; left: var(--mo-ev-at); width: 2px; margin-left: -1px; background: var(--px-text-on-accent); box-shadow: 0 0 0 1px var(--px-bg); pointer-events: none; }
.mo-ev-tag { position: absolute; bottom: var(--px-space-2); padding: 2px var(--px-space-2); border-radius: var(--px-radius-sm); background: var(--px-bg); color: var(--px-text); font-size: var(--px-text-xs); line-height: 1.4; pointer-events: none; }
.mo-ev-tag-a { left: var(--px-space-2); }
.mo-ev-tag-b { right: var(--px-space-2); }
.mo-ev-range { width: 100%; }
`;

/**
 * At start: work folders that are finished with. A preview's folder always is (no dialog is open yet); a run's
 * folder is once its state file is gone. A stopped run's folder, state file and all, stays to be carried on.
 */
export async function moEnhanceVideoSweep(base, sep, dispose) {
  const res = base ? await window.parallxElectron.fs.readdir(base).catch(() => null) : null;
  if (!res || res.error || !Array.isArray(res.entries)) return [];
  const gone = [];
  for (const e of res.entries) {
    if (!e || e.type !== 'directory' || !/^\.enhance-video-[a-z0-9-]+$/.test(e.name)) continue;
    const dir = base + sep + e.name;
    if (/^\.enhance-video-preview-/.test(e.name) || !(await window.parallxElectron.fs.exists(dir + sep + 'state.json').catch(() => true))) gone.push(dir);
  }
  if (gone.length) await dispose(gone);
  return gone;
}

/**
 * The dialog on one library item (a video, or a photo that is a GIF).
 * L, from the library: { db, tools(), workBase(), sep, ingest(path, fileType) -> the new item,
 *   transferPhoto(fromId, toId, basename), dispose(paths), fileUrl(path), showSetUp(), refresh() }.
 */
export async function moEnhanceVideoFromLibrary(api, item, L) {
  const video = item.type === 'video';
  const row = video
    ? await L.db.get('SELECT f.basename, fo.path AS folder_path FROM mo_videos_files vf JOIN mo_files f ON f.id = vf.file_id JOIN mo_folders fo ON fo.id = f.folder_id WHERE vf.video_id = ? AND vf.is_primary = 1', [item.id])
    : await L.db.get('SELECT f.basename, fo.path AS folder_path FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id JOIN mo_folders fo ON fo.id = f.folder_id WHERE pf.photo_id = ? AND pf.is_primary = 1', [item.id]);
  const path = row ? row.folder_path.replace(/[\/]+$/, '') + L.sep + row.basename : null;
  const st = path ? await window.parallxElectron.fs.stat(path).catch(() => null) : null;
  if (!st || st.error) { api.window.showInformationMessage('The file for this item is not on the disk.'); return null; }
  const target = { path, basename: row.basename, kind: video ? 'video' : 'gif', size: st.size, mtime: st.mtime };
  return moEnhanceVideoOpen(api, target, {
    tools: L.tools, workBase: L.workBase, sep: L.sep, dispose: L.dispose, fileUrl: L.fileUrl, showSetUp: L.showSetUp,
    exists: (p) => window.parallxElectron.fs.exists(p),
    finish: async (out) => {
      // The result is an item of its own beside the original, with what the original carries.
      const made = await L.ingest(out, video ? 'video' : 'image');
      if (made && video) await moTransferVideoMetadata(L.db, item.id, made.id, row.basename);
      else if (made) await L.transferPhoto(item.id, made.id, row.basename);
      L.refresh();
    },
  });
}

/** The copy carries what the original carries: title (unless it was just the file name), details, rating, label, tags and albums. */
export async function moTransferVideoMetadata(db, fromId, toId, fromBasename) {
  const src = await db.get('SELECT * FROM mo_videos WHERE id = ?', [fromId]);
  const dst = await db.get('SELECT title FROM mo_videos WHERE id = ?', [toId]);
  if (!src || !dst) return;
  const title = (src.title && src.title !== fromBasename) ? src.title : dst.title;
  await db.run("UPDATE mo_videos SET title = ?, details = ?, rating = ?, color_label = ?, curated = ?, updated_at = datetime('now') WHERE id = ?", [title, src.details, src.rating, src.color_label, src.curated, toId]);
  await db.run('INSERT OR IGNORE INTO mo_videos_tags (video_id, tag_id, via_parent_id) SELECT ?, tag_id, via_parent_id FROM mo_videos_tags WHERE video_id = ?', [toId, fromId]);
  await db.run('INSERT OR IGNORE INTO mo_albums_videos (album_id, video_id, position) SELECT album_id, ?, position FROM mo_albums_videos WHERE video_id = ?', [toId, fromId]);
}
