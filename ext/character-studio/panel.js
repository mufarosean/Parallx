// panel.js — one character's editor tab: the 3D view on the left, the
// sliders and looks on the right (Body, Face, Build, Look). Every change is
// saved on its own a moment after the move ends; Undo and Redo step back
// through finished moves.

import { Viewer, HAIR_COLOURS } from './viewer.js';
import { BODY, DETAIL_TABS, detailSections, ageYears, lookName } from './labels.js';
import { normaliseCharacter, defaultCharacter } from './store.js';
import { exportGlb } from './export.js';

const TABS = [{ id: 'body', label: 'Body' }, ...DETAIL_TABS.map((t) => ({ id: t.id, label: t.label })), { id: 'look', label: 'Look' }];
const icon = (api, ...ids) => ids.find((i) => api.icons.hasIcon(i)) || ids[ids.length - 1];
const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * Build the editor for character `id` in `container`.
 * ctx: { figure: Promise<Figure>, store, onDeleted(id), editors: Map, current }.
 */
export function createCharacterEditor(api, ctx, container, input) {
  const id = String((input && (input.instanceId || input.id)) || '');
  const make = (tag, cls, text) => api.ui.createBlock(null, tag, { className: cls || undefined, text: text == null ? undefined : String(text) });
  const root = make('div', 'cs-root');
  container.appendChild(root);
  const subs = [];
  let viewer = null; let figure = null; let record = null; let character = null;
  let tab = 'body'; let filter = '';
  const history = { past: [], future: [] };
  let saveTimer = 0; let applyFrame = 0; let disposed = false; let last = null;
  const sliders = new Map();   // key -> { slider, value element, read(), format() }

  const headerHost = make('div', 'cs-header');
  const main = make('div', 'cs-main');
  const stage = make('div', 'cs-stage');
  const controls = make('div', 'cs-controls');
  root.append(headerHost, main);
  main.append(stage, controls);
  api.ui.createSurface(root, { id: 'character-studio.editor', owner: 'character-studio', label: 'Character Studio', instance: id });
  const status = make('p', 'cs-status', 'Loading the figure…');
  stage.appendChild(status);

  // ── Header ──
  function renderHeader() {
    headerHost.replaceChildren();
    api.ui.createPageHeader(headerHost, {
      title: record ? record.name : 'Character',
      primary: { id: 'character-studio.export', label: 'Export…', icon: 'download', disabled: !viewer, command: 'characterStudio.export', args: [id] },
      more: [
        { label: 'Rename…', icon: 'pencil', onSelect: () => void rename() },
        { label: 'Duplicate', icon: 'copy', onSelect: () => void duplicate() },
        { label: 'Delete', icon: 'trash', onSelect: () => void remove() },
      ],
    });
  }
  renderHeader();

  // ── Load ──
  (async () => {
    try {
      figure = await ctx.figure;
      record = await ctx.store.get(id);
      if (disposed) return;
      if (!record) { status.textContent = 'This character was deleted.'; return; }
      character = normaliseCharacter(record.data, figure);
      last = JSON.stringify(character);
      if (input && typeof input.setName === 'function') input.setName(record.name);
      status.remove();
      viewer = new Viewer(api, stage, figure);
      buildStageTools();
      viewer.setShape(character);
      await viewer.setLook(character.look);
      viewer.frame('body');
      renderHeader();
      renderControls();
    } catch (err) {
      status.textContent = `The figure could not be shown. ${(err && err.message) || err}`;
      status.setAttribute('role', 'alert');
    }
  })();

  // ── The view's own tools and keys ──
  function buildStageTools() {
    const tools = make('div', 'cs-stage-tools');
    const btn = (key, ico, title, command, args) => api.ui.createIconButton(tools, { id: `character-studio.${key}`, icon: ico, title, size: 'sm', command, args });
    btn('frame-body', icon(api, 'person-standing', 'user'), 'Whole Body (B)', 'characterStudio.view', [id, 'body']);
    btn('frame-face', icon(api, 'scan-face', 'smile'), 'Face (F)', 'characterStudio.view', [id, 'face']);
    btn('turn-left', icon(api, 'rotate-ccw'), 'Turn Left (Left Arrow)', 'characterStudio.view', [id, 'left']);
    btn('turn-right', icon(api, 'rotate-cw'), 'Turn Right (Right Arrow)', 'characterStudio.view', [id, 'right']);
    btn('zoom-in', icon(api, 'zoom-in'), 'Zoom In (+)', 'characterStudio.view', [id, 'in']);
    btn('zoom-out', icon(api, 'zoom-out'), 'Zoom Out (−)', 'characterStudio.view', [id, 'out']);
    btn('undo', icon(api, 'undo-2', 'undo'), 'Undo (Ctrl+Z)', 'characterStudio.undo', [id]);
    btn('redo', icon(api, 'redo-2', 'redo'), 'Redo (Ctrl+Y)', 'characterStudio.redo', [id]);
    stage.appendChild(tools);
    const canvas = viewer.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${record.name}, shown in 3D. Drag or use the arrow keys to turn; plus and minus zoom; F shows the face, B the whole body.`);
    // Turn by dragging (mouse, finger or pen)
    subs.push(api.ui.onDragPress(canvas, (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      let x = e.clientX; let y = e.clientY;
      const move = (m) => { viewer.turn(-(m.clientX - x) * 0.008, (m.clientY - y) * 0.006); x = m.clientX; y = m.clientY; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }));
    const wheel = (e) => { e.preventDefault(); viewer.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08); };
    canvas.addEventListener('wheel', wheel, { passive: false });
    const keys = (e) => {
      const k = e.key;
      const step = e.shiftKey ? Math.PI / 4 : Math.PI / 16;
      if (k === 'ArrowLeft') viewer.turn(-step, 0);
      else if (k === 'ArrowRight') viewer.turn(step, 0);
      else if (k === 'ArrowUp') viewer.turn(0, 0.06);
      else if (k === 'ArrowDown') viewer.turn(0, -0.06);
      else if (k === '+' || k === '=') viewer.zoom(0.85);
      else if (k === '-' || k === '_') viewer.zoom(1 / 0.85);
      else if (k === 'f' || k === 'F') viewer.frame('face');
      else if (k === 'b' || k === 'B' || k === 'Home') viewer.frame('body');
      else return;
      e.preventDefault();
    };
    canvas.addEventListener('keydown', keys);
    subs.push({ dispose: () => { canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', keys); } });
  }

  // ── Controls ──
  function renderControls() {
    controls.replaceChildren(); sliders.clear();
    const head = make('div', 'cs-tabs');
    controls.appendChild(head);
    api.ui.createTabs(head, { id: 'character-studio.tabs', label: 'Character sections', items: TABS, active: tab, onSelect: (t) => { tab = t; filter = ''; renderControls(); } });
    const body = make('div', 'cs-tab-body');
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-label', TABS.find((t) => t.id === tab).label);
    controls.appendChild(body);
    if (tab === 'body') renderBody(body);
    else if (tab === 'look') renderLook(body);
    else renderDetails(body, DETAIL_TABS.find((t) => t.id === tab));
  }

  function sliderRow(parent, { key, name, min, max, value, format, onInput, onCommit }) {
    const row = make('div', 'cs-slider');
    const top = make('div', 'cs-slider-head');
    const label = make('span', 'cs-slider-name', name);
    const out = make('span', 'cs-slider-value', format(value));
    top.append(label, out);
    row.appendChild(top);
    const s = api.ui.createSlider(row, {
      id: `character-studio.slider.${api.ui.sceneSlug(key)}`, label: name, min, max, step: 0.01, value,
      onChange: (v) => { out.textContent = format(v); onInput(v); },
      onCommit: (v) => { out.textContent = format(v); onCommit(v); },
    });
    const input = s.element.querySelector('input');
    if (input) input.setAttribute('aria-valuetext', format(value));
    const set = (v) => { s.setValue(v); out.textContent = format(v); if (input) input.setAttribute('aria-valuetext', format(v)); };
    s.element.addEventListener('input', () => { if (input) input.setAttribute('aria-valuetext', format(s.value)); });
    parent.appendChild(row);
    sliders.set(key, { set, read: () => s.value });
    return row;
  }

  function renderBody(body) {
    for (const b of BODY) {
      const format = b.id === 'age' ? (v) => `${ageYears(v)} years` : b.id === 'gender' ? (v) => (Math.abs(v - 0.5) < 0.01 ? 'Even' : v > 0.5 ? `${b.ends[1]} ${pct((v - 0.5) * 2)}` : `${b.ends[0]} ${pct((0.5 - v) * 2)}`) : pct;
      sliderRow(body, {
        key: `body.${b.id}`, name: b.name, min: 0, max: 1, value: character.body[b.id], format,
        onInput: (v) => { character.body[b.id] = v; scheduleShape(); },
        onCommit: () => commit(),
      });
    }
    const row = make('div', 'cs-row-actions');
    api.ui.createButton(row, { id: 'character-studio.reset-body', label: 'Reset Body', icon: icon(api, 'rotate-ccw'), kind: 'ghost', size: 'sm', command: 'characterStudio.reset', args: [id, 'body'] });
    body.appendChild(row);
  }

  function renderDetails(body, detailTab) {
    const top = make('div', 'cs-detail-tools');
    api.ui.createInput(top, { id: `character-studio.find.${detailTab.id}`, label: 'Find a slider', value: filter, placeholder: 'Find a slider', onChange: (v) => { filter = v; drawList(); } });
    api.ui.createToggle(top, { id: 'character-studio.symmetric', label: 'Same on both sides', checked: character.symmetric, onChange: (on) => { character.symmetric = on; if (on) mirrorRight(); commit(); drawList(); } });
    api.ui.createButton(top, { id: `character-studio.reset-${detailTab.id}`, label: `Reset ${detailTab.label}`, icon: icon(api, 'rotate-ccw'), kind: 'ghost', size: 'sm', command: 'characterStudio.reset', args: [id, detailTab.id] });
    body.appendChild(top);
    const list = make('div', 'cs-detail-list');
    body.appendChild(list);
    const sections = detailSections(figure.details, detailTab);
    function drawList() {
      list.replaceChildren();
      for (const k of [...sliders.keys()]) if (k.startsWith('detail.')) sliders.delete(k);
      const f = filter.trim().toLowerCase();
      let shown = 0;
      for (const sec of sections) {
        const items = sec.sliders.filter((s) => !f || s.name.toLowerCase().includes(f) || sec.name.toLowerCase().includes(f));
        if (!items.length) continue;
        api.ui.createSectionLabel(list, sec.name);
        for (const s of items) {
          const sides = s.unsided ? [['unsided', s.unsided]] : character.symmetric ? [['both', s.left]] : [['left', s.left], ['right', s.right]];
          for (const [side, label] of sides) {
            const name = side === 'left' ? `${s.name}, left` : side === 'right' ? `${s.name}, right` : s.name;
            const format = (v) => (Math.abs(v) < 0.005 ? 'Neutral' : `${v < 0 ? s.ends[0] : s.ends[1]} ${pct(Math.abs(v))}`);
            sliderRow(list, {
              key: `detail.${label}`, name, min: -1, max: 1, value: character.details[label] || 0, format,
              onInput: (v) => { setDetail(label, v, side === 'both' ? s.right : null); scheduleShape(); },
              onCommit: () => commit(),
            });
            shown++;
          }
        }
      }
      if (!shown) api.ui.createEmptyState(list, { headline: 'No slider matches.', hint: 'Try another word, such as nose or jaw.' });
    }
    drawList();
  }

  function setDetail(label, v, mirror) {
    if (Math.abs(v) < 0.005) delete character.details[label]; else character.details[label] = v;
    if (mirror) { if (Math.abs(v) < 0.005) delete character.details[mirror]; else character.details[mirror] = v; }
  }

  /** Symmetry turned on: each right side takes its left side's value. */
  function mirrorRight() {
    for (const d of figure.details) {
      if (d.side !== 'right') continue;
      const left = figure.details.find((x) => x.category === d.category && x.side === 'left');
      if (left) setDetail(d.label, character.details[left.label] || 0, null);
    }
  }

  function resetDetails(detailTab) {
    for (const d of figure.details) if (detailTab.groups.includes(d.group)) delete character.details[d.label];
    commit(); applyAll();
  }

  function renderLook(body) {
    const kinds = (kind) => figure.items.filter((i) => i.kind === kind);
    const select = (key, label, items, value, onChange) => {
      const row = make('div', 'cs-look-row');
      row.appendChild(make('span', 'cs-slider-name', label));
      api.ui.createSelect(row, { id: `character-studio.look.${key}`, label, items, value, onChange });
      body.appendChild(row);
    };
    const setLook = (k) => (v) => { character.look[k] = v; commit(); void viewer.setLook(character.look); };
    select('skin', 'Skin', figure.meta.skins.map((s) => ({ value: s.id, label: lookName(s.name) })), character.look.skin, setLook('skin'));
    select('iris', 'Eye colour', figure.meta.irises.map((s) => ({ value: s.id, label: lookName(s.name) })), character.look.iris, setLook('iris'));
    select('hair', 'Hair', [{ value: 'none', label: 'None' }, ...kinds('hair').map((s) => ({ value: s.id, label: lookName(s.name) }))], character.look.hair, setLook('hair'));
    select('hairColour', 'Hair colour', HAIR_COLOURS.map((c) => ({ value: c.id, label: c.name })), character.look.hairColour, setLook('hairColour'));
    select('eyebrows', 'Eyebrows', [{ value: 'none', label: 'None' }, ...kinds('eyebrows').map((s) => ({ value: s.id, label: lookName(s.name) }))], character.look.eyebrows, setLook('eyebrows'));
    select('eyelashes', 'Eyelashes', [{ value: 'none', label: 'None' }, ...kinds('eyelashes').map((s) => ({ value: s.id, label: lookName(s.name) }))], character.look.eyelashes, setLook('eyelashes'));
  }

  // ── Changes, history, saving ──
  function scheduleShape() {
    if (applyFrame) return;
    applyFrame = requestAnimationFrame(() => { applyFrame = 0; if (viewer) viewer.setShape(character); });
  }

  /** A finished move: one undo step, then save a moment later. */
  function commit() {
    const snap = JSON.stringify(character);
    if (last !== null && snap === last) return;
    if (last !== null) { history.past.push(last); if (history.past.length > 200) history.past.shift(); history.future.length = 0; }
    last = snap;
    scheduleSave();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save(); }, 700);
  }
  async function save() {
    saveTimer = 0;
    if (!viewer || !record) return;
    try { await ctx.store.save(id, character, await viewer.thumbnail()); }
    catch (err) { api.window.showErrorMessage(`The character could not be saved. ${(err && err.message) || err}`); }
  }
  function applyAll() {
    viewer.setShape(character);
    void viewer.setLook(character.look);
    renderControls();
  }
  function undo() {
    if (!history.past.length) return;
    history.future.push(last); last = history.past.pop();
    character = JSON.parse(last); applyAll(); scheduleSave();
  }
  function redo() {
    if (!history.future.length) return;
    history.past.push(last); last = history.future.pop();
    character = JSON.parse(last); applyAll(); scheduleSave();
  }

  // ── Header actions ──
  async function rename() {
    const name = await api.window.showInputBox({ prompt: 'Name', value: record.name });
    if (!name || !name.trim() || name.trim() === record.name) return;
    record.name = name.trim();
    await ctx.store.rename(id, record.name);
    if (input && typeof input.setName === 'function') input.setName(record.name);
    renderHeader();
  }
  async function duplicate() {
    const name = await ctx.store.freeName(`${record.name} copy`);
    const newId = await ctx.store.create(name, character);
    await api.editors.openEditor({ typeId: 'character-studio', title: name, icon: 'user', instanceId: newId });
  }
  async function remove() {
    clearTimeout(saveTimer);
    const row = await ctx.store.remove(id);
    ctx.onDeleted(id);
    if (row) api.ui.showUndoToast({ message: `${row.name} deleted`, undo: () => void ctx.store.restore(row) });
  }
  async function doExport() {
    if (!viewer) return;
    try { await exportGlb(api, viewer, record.name); }
    catch (err) { api.window.showErrorMessage(`The character could not be exported. ${(err && err.message) || err}`); }
  }

  // Undo and Redo by keys go to the editor last used
  ctx.editors.set(id, {
    undo, redo,
    view(action) {
      if (!viewer) return;
      if (action === 'body' || action === 'face') viewer.frame(action);
      else if (action === 'left' || action === 'right') viewer.turn((action === 'left' ? -1 : 1) * Math.PI / 8, 0);
      else if (action === 'in' || action === 'out') viewer.zoom(action === 'in' ? 0.85 : 1 / 0.85);
    },
    reset(part) {
      if (!character) return;
      if (part === 'body') { character.body = { ...defaultCharacter(figure).body, gender: character.body.gender }; commit(); applyAll(); return; }
      const t = DETAIL_TABS.find((x) => x.id === part);
      if (t) resetDetails(t);
    },
    exportNow: () => doExport(),
  });
  ctx.current = id;
  const focused = () => { ctx.current = id; };
  root.addEventListener('focusin', focused);
  root.addEventListener('pointerdown', focused);

  return {
    dispose() {
      disposed = true;
      root.removeEventListener('focusin', focused);
      root.removeEventListener('pointerdown', focused);
      if (saveTimer) { clearTimeout(saveTimer); void save(); }
      if (applyFrame) cancelAnimationFrame(applyFrame);
      ctx.editors.delete(id); if (ctx.current === id) ctx.current = null;
      for (const s of subs) { try { s.dispose(); } catch { /* gone */ } }
      if (viewer) viewer.dispose();
      root.remove();
    },
  };
}
