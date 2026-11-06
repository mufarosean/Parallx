// panel.js — one character's editor tab: the stage on the left; on the right
// Character (body and outfit, face, hair), Body, Face, Colour and Mood. Every
// change is saved on its own a moment after it ends; Undo and Redo step back
// through finished changes.

import { Viewer } from './viewer.js';
import { SHAPE_SLIDERS, PALETTES, EXPRESSIONS, normaliseCharacter, defaultCharacter } from './anime.js';

const TABS = [
  { id: 'character', label: 'Parts' }, { id: 'body', label: 'Body' }, { id: 'face', label: 'Face' },
  { id: 'colour', label: 'Colour' }, { id: 'mood', label: 'Mood' },
].map((t) => ({ ...t, closable: false }));
const icon = (api, ...ids) => ids.find((i) => api.icons.hasIcon(i)) || ids[ids.length - 1];
const VIEW_HINT = 'Drag or use the arrow keys to turn; plus and minus zoom; F shows the face, B the whole body.';

/**
 * Build the editor for character `id` in `container`.
 * ctx: { catalogue: Promise, store, portraits(framing), onDeleted(id), editors: Map, current }.
 */
export function createCharacterEditor(api, ctx, container, input) {
  const id = String((input && (input.instanceId || input.id)) || '');
  const make = (tag, cls, text) => api.ui.createBlock(null, tag, { className: cls || undefined, text: text == null ? undefined : String(text) });
  const root = make('div', 'cs-root');
  container.appendChild(root);
  const subs = [];
  let viewer = null; let catalogue = null; let record = null; let character = null; let disposed = false;
  let tab = 'character';
  const history = { past: [], future: [] }; let last = null;
  let saveTimer = 0; let shapeFrame = 0;

  const headerHost = make('div', 'cs-header');
  const main = make('div', 'cs-main');
  const stage = make('div', 'cs-stage');
  const controls = make('div', 'cs-controls');
  root.append(headerHost, main);
  main.append(stage, controls);
  api.ui.createSurface(root, { id: 'character-studio.editor', owner: 'character-studio', label: 'Character Studio', instance: id });
  const status = make('p', 'cs-status', 'Loading the character…');
  stage.appendChild(status);

  function renderHeader() {
    headerHost.replaceChildren();
    api.ui.createPageHeader(headerHost, {
      title: record ? record.name : 'Character',
      primary: { id: 'character-studio.picture', label: 'Save Picture…', icon: icon(api, 'camera', 'image'), disabled: !viewer, command: 'characterStudio.picture', args: [id] },
      secondary: [{ id: 'character-studio.randomise', label: 'Randomise', icon: icon(api, 'dices', 'shuffle'), disabled: !viewer, command: 'characterStudio.randomise', args: [id] }],
      more: [
        { label: 'Rename…', icon: 'pencil', onSelect: () => void rename() },
        { label: 'Duplicate', icon: 'copy', onSelect: () => void duplicate() },
        { label: 'Delete', icon: 'trash', onSelect: () => void remove() },
      ],
    });
  }
  renderHeader();

  (async () => {
    try {
      catalogue = await ctx.catalogue;
      record = await ctx.store.get(id);
      if (disposed) return;
      if (!record) { status.textContent = 'This character was deleted.'; return; }
      character = normaliseCharacter(record.data, catalogue);
      last = JSON.stringify(character);
      if (input && typeof input.setName === 'function') input.setName(record.name);
      viewer = new Viewer(api, stage, catalogue);
      await viewer.show(character);
      if (disposed) return;
      status.remove();
      viewer.frame('body');
      buildStageTools();
      renderHeader();
      renderControls();
    } catch (err) {
      status.textContent = `The character could not be shown. ${(err && err.message) || err}`;
      status.setAttribute('role', 'alert');
    }
  })();

  // ── The stage's tools and keys ──
  function buildStageTools() {
    const tools = make('div', 'cs-stage-tools');
    const btn = (key, ico, title, args) => api.ui.createIconButton(tools, { id: `character-studio.${key}`, icon: ico, title, size: 'sm', command: 'characterStudio.view', args: [id, ...args] });
    btn('frame-body', icon(api, 'person-standing', 'user'), 'Whole Body (B)', ['body']);
    btn('frame-face', icon(api, 'scan-face', 'smile'), 'Face (F)', ['face']);
    btn('turn-left', icon(api, 'rotate-ccw'), 'Turn Left (Left Arrow)', ['left']);
    btn('turn-right', icon(api, 'rotate-cw'), 'Turn Right (Right Arrow)', ['right']);
    btn('zoom-in', icon(api, 'zoom-in'), 'Zoom In (+)', ['in']);
    btn('zoom-out', icon(api, 'zoom-out'), 'Zoom Out (−)', ['out']);
    api.ui.createIconButton(tools, { id: 'character-studio.undo', icon: icon(api, 'undo-2', 'undo'), title: 'Undo (Ctrl+Z)', size: 'sm', command: 'characterStudio.undo', args: [id] });
    api.ui.createIconButton(tools, { id: 'character-studio.redo', icon: icon(api, 'redo-2', 'redo'), title: 'Redo (Ctrl+Y)', size: 'sm', command: 'characterStudio.redo', args: [id] });
    stage.appendChild(tools);
    const canvas = viewer.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${record.name}, shown in 3D. ${VIEW_HINT}`);
    subs.push(api.ui.onDragPress(canvas, (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      let x = e.clientX; let y = e.clientY;
      const move = (m) => { viewer.turn(-(m.clientX - x) * 0.008, (m.clientY - y) * 0.006); x = m.clientX; y = m.clientY; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }));
    const wheel = (e) => { e.preventDefault(); viewer.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08); };
    const keys = (e) => {
      const step = e.shiftKey ? Math.PI / 4 : Math.PI / 16;
      const k = e.key;
      if (k === 'ArrowLeft') viewer.turn(-step, 0); else if (k === 'ArrowRight') viewer.turn(step, 0);
      else if (k === 'ArrowUp') viewer.turn(0, 0.06); else if (k === 'ArrowDown') viewer.turn(0, -0.06);
      else if (k === '+' || k === '=') viewer.zoom(0.85); else if (k === '-' || k === '_') viewer.zoom(1 / 0.85);
      else if (k === 'f' || k === 'F') viewer.frame('face'); else if (k === 'b' || k === 'B' || k === 'Home') viewer.frame('body');
      else return;
      e.preventDefault();
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', keys);
    subs.push({ dispose: () => { canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', keys); } });
  }

  // ── Controls ──
  let tabBody = null;
  function renderControls() {
    if (!tabBody) {
      const head = make('div', 'cs-tabs');
      controls.appendChild(head);
      api.ui.createTabs(head, { id: 'character-studio.tabs', label: 'Character sections', items: TABS, active: tab, onSelect: (t) => { if (t === tab) return; tab = t; renderControls(); } });
      tabBody = make('div', 'cs-tab-body');
      tabBody.setAttribute('role', 'tabpanel');
      controls.appendChild(tabBody);
    }
    tabBody.replaceChildren(); tabBody.scrollTop = 0;
    tabBody.setAttribute('aria-label', TABS.find((t) => t.id === tab).label);
    ({ character: renderParts, body: () => renderSliders(['proportions', 'build']), face: () => renderSliders(['face']), colour: renderColours, mood: renderMood })[tab]();
  }

  function section(label) { const s = make('section', 'cs-section'); tabBody.appendChild(s); api.ui.createSectionLabel(s, label); return s; }

  function renderParts() {
    for (const [part, label, framing] of [['body', 'Body and outfit', 'body'], ['face', 'Face', 'face'], ['hair', 'Hair', 'face']]) {
      const s = section(label);
      const grid = api.ui.createChoiceGrid(s, {
        id: `character-studio.part.${part}`, label, value: character.parts[part],
        items: catalogue.models.map((m) => ({ value: m.id, label: m.name })),
        onChange: (v) => setPart(part, v),
      });
      ctx.portraits(framing).then((pics) => { if (!disposed) for (const [mid, url] of pics) grid.setImage(mid, url); }).catch(() => {});
    }
  }

  function setPart(part, value) {
    if (part === 'body') {
      // A face and hair that came with the old body follow it; ones taken from elsewhere stay
      const old = character.parts.body;
      character.parts = { body: value, face: character.parts.face === old ? value : character.parts.face, hair: character.parts.hair === old ? value : character.parts.hair };
    } else character.parts = { ...character.parts, [part]: value };
    commit();
    void viewer.show(character).then(() => { if (tab === 'character' && part === 'body') renderControls(); });
  }

  function renderSliders(groups) {
    const names = { proportions: 'Proportions', build: 'Build', face: 'Face shape' };
    for (const g of groups) {
      const s = section(names[g]);
      for (const sl of SHAPE_SLIDERS.filter((x) => x.group === g)) {
        const offset = sl.min < 0;
        const format = (v) => (offset ? (Math.abs(v) < 0.01 ? 'Even' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}`) : `${Math.round(v * 100)}%`);
        const row = make('div', 'cs-slider');
        const top = make('div', 'cs-slider-head');
        const out = make('span', 'cs-slider-value', format(character.shape[sl.id]));
        top.append(make('span', 'cs-slider-name', sl.name), out);
        row.appendChild(top);
        const k = api.ui.createSlider(row, {
          id: `character-studio.slider.${sl.id}`, label: sl.name, min: sl.min, max: sl.max, step: 0.01, value: character.shape[sl.id],
          onChange: (v) => { out.textContent = format(v); character.shape[sl.id] = v; scheduleShape(); },
          onCommit: () => commit(),
        });
        const inputEl = k.element.querySelector('input');
        if (inputEl) { inputEl.setAttribute('aria-valuetext', format(character.shape[sl.id])); k.element.addEventListener('input', () => inputEl.setAttribute('aria-valuetext', format(k.value))); }
        s.appendChild(row);
      }
    }
    const row = make('div', 'cs-row-actions');
    api.ui.createButton(row, { id: `character-studio.reset-${tab}`, label: tab === 'face' ? 'Reset Face' : 'Reset Body', icon: icon(api, 'rotate-ccw'), kind: 'ghost', size: 'sm', command: 'characterStudio.reset', args: [id, tab] });
    tabBody.appendChild(row);
  }

  function renderColours() {
    for (const [slot, label, pal] of [['skin', 'Skin', 'skin'], ['hair', 'Hair', 'hair'], ['eyes', 'Eyes', 'eyes'], ['top', 'Top', 'outfit'], ['bottom', 'Bottom and shoes', 'outfit']]) {
      const s = section(label);
      api.ui.createChoiceGrid(s, {
        id: `character-studio.colour.${slot}`, label: `${label} colour`, variant: 'swatch', value: character.colours[slot],
        items: PALETTES[pal].map((c) => ({ value: c.id, label: c.name, rgb: c.rgb || undefined })),
        onChange: (v) => { character.colours = { ...character.colours, [slot]: v }; commit(); void viewer.show(character); },
      });
    }
  }

  function renderMood() {
    const s = section('Expression');
    const grid = api.ui.createChoiceGrid(s, {
      id: 'character-studio.expression', label: 'Expression', value: character.expression,
      items: EXPRESSIONS.map((e) => ({ value: e.id, label: e.name })),
      onChange: (v) => { character.expression = v; commit(); void viewer.show(character); },
    });
    // A portrait of this character wearing each expression
    (async () => {
      for (const e of EXPRESSIONS) {
        if (disposed || tab !== 'mood' || !viewer || !viewer.character) break;
        viewer.character.setExpression(e.id); viewer.character.update(0, 0);
        grid.setImage(e.id, await viewer.picture({ size: 120, framing: 'face', yaw: 0.15 }));
      }
      if (!disposed && viewer && viewer.character) { viewer.character.setExpression(character.expression); viewer.kick(); }
    })();
  }

  // ── Changes, history, saving ──
  function scheduleShape() {
    if (shapeFrame) return;
    shapeFrame = requestAnimationFrame(() => { shapeFrame = 0; if (viewer) viewer.reshape(character.shape); });
  }
  function commit() {
    const snap = JSON.stringify(character);
    if (snap === last) return;
    if (last !== null) { history.past.push(last); if (history.past.length > 200) history.past.shift(); history.future.length = 0; }
    last = snap;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save(); }, 700);
  }
  async function save() {
    saveTimer = 0;
    if (!viewer || !record) return;
    try { await ctx.store.save(id, character, await viewer.picture({ size: 96, framing: 'face' })); }
    catch (err) { api.window.showErrorMessage(`The character could not be saved. ${(err && err.message) || err}`); }
  }
  async function apply(next) {
    character = normaliseCharacter(next, catalogue);
    await viewer.show(character);
    renderControls();
  }
  function step(from, to) {
    if (!from.length || !viewer) return;
    to.push(last); last = from.pop();
    void apply(JSON.parse(last));
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { void save(); }, 700);
  }

  /** A whole new character at random: parts, shape and colours. */
  function randomise() {
    const any = (list) => list[Math.floor(Math.random() * list.length)];
    const ids = catalogue.models.map((m) => m.id);
    const next = defaultCharacter(catalogue, any(ids));
    next.parts.face = Math.random() < 0.5 ? next.parts.body : any(ids);
    next.parts.hair = Math.random() < 0.5 ? next.parts.body : any(ids);
    for (const sl of SHAPE_SLIDERS) next.shape[sl.id] = sl.value + (Math.random() - 0.5) * (sl.max - sl.min) * 0.5;
    for (const [slot, pal] of [['skin', 'skin'], ['hair', 'hair'], ['eyes', 'eyes'], ['top', 'outfit'], ['bottom', 'outfit']]) next.colours[slot] = Math.random() < 0.4 ? 'own' : any(PALETTES[pal]).id;
    next.expression = any(EXPRESSIONS).id;
    void apply(next).then(() => commit());
  }

  // ── Header actions ──
  async function rename() {
    const name = await api.window.showInputBox({ prompt: 'Name', value: record.name });
    if (!name || !name.trim() || name.trim() === record.name) return;
    await ctx.store.rename(id, name.trim());
  }
  async function duplicate() {
    const name = await ctx.store.freeName(`${record.name} copy`);
    const newId = await ctx.store.create(name, character);
    await api.editors.openEditor({ typeId: 'character-studio', title: name, icon: 'user', instanceId: newId });
  }
  async function remove() {
    clearTimeout(saveTimer); saveTimer = 0;
    const row = await ctx.store.remove(id);
    ctx.onDeleted(id);
    if (row) api.ui.showUndoToast({ message: `${row.name} deleted`, undo: () => void ctx.store.restore(row) });
  }
  async function savePicture() {
    const electron = globalThis.parallxElectron;
    if (!electron || !electron.dialog || !electron.dialog.saveFile) { api.window.showErrorMessage('Saving a picture needs the desktop app.'); return; }
    const safe = String(record.name || 'Character').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Character';
    const target = await electron.dialog.saveFile({ title: 'Save Picture', defaultName: `${safe}.png`, filters: [{ name: 'PNG picture', extensions: ['png'] }] });
    if (!target) return;
    const bytes = await viewer.snapshot();
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const r = await electron.fs.writeFile(target, btoa(bin), 'base64');
    if (r && r.error) api.window.showErrorMessage(`The picture could not be saved. ${r.error.message || r.error}`);
  }

  // A rename from the Characters list shows here too
  subs.push(ctx.store.onDidChange(async () => {
    if (!record || disposed) return;
    const fresh = await ctx.store.get(id).catch(() => null);
    if (!fresh || fresh.name === record.name || disposed) return;
    record.name = fresh.name;
    if (input && typeof input.setName === 'function') input.setName(record.name);
    if (viewer) viewer.canvas.setAttribute('aria-label', `${record.name}, shown in 3D. ${VIEW_HINT}`);
    renderHeader();
  }));

  ctx.editors.set(id, {
    undo: () => step(history.past, history.future),
    redo: () => step(history.future, history.past),
    view(action) {
      if (!viewer) return;
      if (action === 'body' || action === 'face') viewer.frame(action);
      else if (action === 'left' || action === 'right') viewer.turn((action === 'left' ? -1 : 1) * Math.PI / 8, 0);
      else if (action === 'in' || action === 'out') viewer.zoom(action === 'in' ? 0.85 : 1 / 0.85);
    },
    reset(part) {
      if (!character) return;
      for (const sl of SHAPE_SLIDERS) if ((part === 'face') === (sl.group === 'face')) character.shape[sl.id] = sl.value;
      commit(); void apply(character);
    },
    randomise: () => { if (viewer) randomise(); },
    picture: () => (viewer ? savePicture() : undefined),
  });
  ctx.current = id;
  const focused = () => { ctx.current = id; };
  root.addEventListener('focusin', focused);
  root.addEventListener('pointerdown', focused);

  return {
    dispose() {
      disposed = true;
      root.removeEventListener('focusin', focused); root.removeEventListener('pointerdown', focused);
      if (saveTimer) { clearTimeout(saveTimer); void save(); }
      if (shapeFrame) cancelAnimationFrame(shapeFrame);
      ctx.editors.delete(id); if (ctx.current === id) ctx.current = null;
      for (const s of subs) { try { s.dispose(); } catch { /* gone */ } }
      if (viewer) viewer.dispose();
      root.remove();
    },
  };
}
