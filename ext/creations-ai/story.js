// story.js — Creations AI: the Story Writer.
//
// A rail of stories and, for the open one, a single column: the bar (title,
// status, Export As Markdown, New Chapter), the Brief (premise, genre,
// setting, cast from your characters, style, point of view, tense, beat
// length, the author's note), the Story Memory, then the chapters with
// their beats, each edited in place with Rewrite and Undo, and the
// composer at the end: a direction and Continue. Beats stream in as they
// are written. Autosaves. Design and gates: docs/CREATIONS_AI.md, slice 3.
//
// Pure parts live in story-core.js. tests/unit/creationsStoryPane.test.ts
// drives this file with a stubbed model and file system.

import { injectStudioStyles } from './studio.js';
import {
  newStory, emptyBrief, POVS, TENSES, BEAT_LENGTHS, castEntryFromCharacter,
  buildBeatMessages, buildMemoryMessages, cleanBeat, storyMarkdown, storyFileName, storyWords,
} from './story-core.js';
import { parseJsonLoose, stripDashes, countWords } from './studio-core.js';

const STYLE_ID = 'creations-story-styles';
const AUTOSAVE_MS = 800;
const MEMORY_EVERY = 4;
const STORIES_DIR = 'stories';

export function injectStoryStyles() {
  injectStudioStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.st { max-width: 860px; }
.st-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--px-space-3); }
.st-cast { display: flex; flex-wrap: wrap; gap: var(--px-space-1); align-items: center; }
.st-cast .cs-chip { line-height: 22px; padding-right: 2px; }
.st-cast .cs-icon-btn { width: 18px; height: 18px; }
.st-chapter { border-top: 1px solid var(--px-divider); padding-top: var(--px-space-3); }
.st-chapter-head { display: flex; align-items: center; gap: var(--px-space-2); }
.st-chapter-title { flex: 1; min-width: 0; font-size: var(--px-text-lg); font-weight: 600; background: transparent; border: 0; border-bottom: 1px solid transparent; color: var(--px-text); padding: 2px 0; outline: none; font-family: inherit; }
.st-chapter-title:hover { border-bottom-color: var(--px-border); }
.st-chapter-title:focus { border-bottom-color: var(--px-accent); }
.st-chapter-meta { font-size: var(--px-text-xs); color: var(--px-text-muted); white-space: nowrap; }
.st-beats { display: flex; flex-direction: column; }
.st-beat { position: relative; padding: var(--px-space-2) 0; border-bottom: 1px solid var(--px-divider); }
.st-beat-text { width: 100%; box-sizing: border-box; background: transparent; border: 1px solid transparent; border-radius: var(--px-radius-sm); color: var(--px-text); font: inherit; font-size: var(--px-text-md); line-height: 1.65; padding: 6px var(--px-space-2); resize: none; overflow: hidden; min-height: 40px; }
.st-beat-text:hover { border-color: var(--px-border); }
.st-beat-text:focus { outline: none; border-color: var(--px-accent); background: var(--px-bg-inset); }
.st-beat--live .st-beat-text { color: var(--px-text-secondary); }
.st-beat-actions { display: flex; gap: 2px; justify-content: flex-end; opacity: 0; transition: opacity .12s; margin-top: 2px; }
.st-beat:hover .st-beat-actions, .st-beat:focus-within .st-beat-actions, .st-beat--undo .st-beat-actions, .st-beat--rewriting .st-beat-actions { opacity: 1; }
.st-beat-steer { display: flex; gap: var(--px-space-2); margin-top: var(--px-space-1); }
.st-beat-steer .cs-input { flex: 1; }
.st-beat-error { font-size: var(--px-text-xs); color: var(--px-danger); display: flex; gap: var(--px-space-2); align-items: center; margin-top: var(--px-space-1); }
.st-composer { display: flex; gap: var(--px-space-2); align-items: center; padding-top: var(--px-space-3); border-top: 1px solid var(--px-divider); }
.st-composer .cs-input { flex: 1; }
.st-empty { font-size: var(--px-text-sm); color: var(--px-text-muted); padding: var(--px-space-4) 0; }
.st-memory { min-height: 80px; font-size: var(--px-text-sm); }
`;
  document.head.appendChild(style);
}

// ── Storage ────────────────────────────────────────────────────────────────

export async function listStories(fs, workspaceUri, deps) {
  const dir = deps.resolveUri(workspaceUri, `${deps.extRoot}/${STORIES_DIR}`);
  try {
    const entries = await fs.readdir(dir);
    const out = [];
    for (const e of entries) {
      if (e.type !== 1 || !e.name.endsWith('.json')) continue;
      try {
        const { content } = await fs.readFile(deps.resolveUri(dir, e.name));
        const story = JSON.parse(content);
        if (story && story.id) out.push({ fileName: e.name, story });
      } catch (err) { console.warn('[Creations] Skipped unreadable story', e.name, err); }
    }
    return out.sort((a, b) => (b.story.updatedAt || 0) - (a.story.updatedAt || 0));
  } catch { return []; }
}

async function saveStoryFile(fs, workspaceUri, deps, fileName, story) {
  await deps.ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', deps.extFolder, STORIES_DIR]);
  story.updatedAt = Date.now();
  await fs.writeFile(deps.resolveUri(workspaceUri, `${deps.extRoot}/${STORIES_DIR}/${fileName}`), JSON.stringify(story, null, 2));
}

// ── The page: rail + pane ──────────────────────────────────────────────────

export function renderStoriesPage(container, parallx, input, deps) {
  deps.injectStyles?.();
  injectStoryStyles();
  const { el, icon } = deps;
  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  const rawInstance = (input && (input.instanceId || input.id)) || '';
  const root = el('div', 'tg-cc');
  container.appendChild(root);
  if (!fs || !workspaceUri) {
    root.appendChild(el('div', 'tg-empty', { text: 'Open a workspace to write stories.' }));
    return { dispose() { container.innerHTML = ''; } };
  }
  const rail = el('div', 'tg-cc-rail');
  const head = el('div', 'tg-cc-rail-head');
  head.appendChild(el('span', 'tg-cc-rail-title', { text: 'Stories' }));
  const newBtn = el('button', 'tg-cc-rail-add', { html: icon('plus', 14) });
  newBtn.title = 'New Story';
  head.appendChild(newBtn);
  rail.appendChild(head);
  const list = el('div', 'tg-cc-list');
  rail.appendChild(list);
  const pane = el('div', 'tg-cc-pane');
  root.append(rail, pane);

  let selected = null;
  let paneEditor = null;
  const rowByFile = new Map();
  const clearPane = () => { if (paneEditor) { try { paneEditor.dispose?.(); } catch { /* gone */ } paneEditor = null; } pane.innerHTML = ''; };
  const markActive = () => { for (const [f, row] of rowByFile) row.classList.toggle('tg-cc-row--active', f === selected); };

  async function refreshRail() {
    list.innerHTML = '';
    rowByFile.clear();
    const stories = await listStories(fs, workspaceUri, deps);
    if (stories.length === 0) list.appendChild(el('div', 'tg-cc-list-empty', { text: 'No stories yet.' }));
    for (const { fileName, story } of stories) {
      const row = el('div', 'tg-cc-row');
      rowByFile.set(fileName, row);
      row.appendChild(el('span', 'tg-cc-row-icon', { html: icon('book-open', 14) }));
      row.appendChild(el('span', 'tg-cc-row-name', { text: story.title || 'Untitled' }));
      const acts = el('span', 'tg-cc-row-actions');
      const del = el('button', 'tg-cc-row-action tg-cc-row-action--danger', { html: icon('trash', 12) });
      del.title = 'Delete';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        const choice = await parallx.window.showWarningMessage(`Delete "${story.title || 'Untitled'}"? This cannot be undone.`, { title: 'Delete' });
        if (!choice || choice.title !== 'Delete') return;
        if (selected === fileName) { try { paneEditor?.abandon?.(); } catch { /* gone */ } }
        try { await fs.delete(deps.resolveUri(workspaceUri, `${deps.extRoot}/${STORIES_DIR}/${fileName}`)); } catch { /* already gone */ }
        if (selected === fileName) { selected = null; clearPane(); showEmpty(); }
        await refreshRail();
        deps.refreshSidebar?.();
      });
      acts.appendChild(del);
      row.appendChild(acts);
      row.addEventListener('click', () => open(fileName));
      list.appendChild(row);
    }
    markActive();
  }
  function showEmpty() {
    const empty = el('div', 'tg-cc-empty px-empty');
    empty.appendChild(el('div', null, { html: icon('book-open', 32) }));
    empty.appendChild(el('div', 'px-empty__headline', { text: 'Nothing open' }));
    empty.appendChild(el('div', 'px-empty__hint', { text: 'Pick a story, or start a new one.' }));
    pane.appendChild(empty);
  }
  function open(fileName) {
    if (selected === fileName && paneEditor) return;
    clearPane();
    selected = fileName;
    markActive();
    paneEditor = renderStoryPane(pane, parallx, { fs, workspaceUri, fileName, onCreated: async (f) => { selected = f; await refreshRail(); deps.refreshSidebar?.(); } }, deps);
  }
  function openNew() {
    clearPane();
    selected = null;
    markActive();
    paneEditor = renderStoryPane(pane, parallx, { fs, workspaceUri, fileName: null, onCreated: async (f) => { selected = f; await refreshRail(); deps.refreshSidebar?.(); } }, deps);
  }
  newBtn.addEventListener('click', () => openNew());
  refreshRail().then(() => {
    if (rawInstance === 'new') openNew();
    else if (rawInstance && rawInstance.endsWith('.json')) open(rawInstance);
    else showEmpty();
  }).catch((err) => console.warn('[Creations] Stories rail failed:', err));
  return { dispose() { clearPane(); container.innerHTML = ''; } };
}

// ── The pane ───────────────────────────────────────────────────────────────

export function renderStoryPane(container, parallx, ctx, deps) {
  injectStoryStyles();
  const { el, icon, tgSelect } = deps;
  const { fs, workspaceUri } = ctx;
  const root = el('div', 'cs st');
  container.appendChild(root);

  const state = {
    fileName: ctx.fileName || null,
    story: newStory(`story-${deps.generateId().slice(0, 8)}`),
    busy: false,
    stop: false,
    dirty: false,
    saveTimer: null,
    disposed: false,
    undo: new Map(),
    engine: { modelId: '', numCtx: 0 },
    characters: [],
  };

  // ── Bar ────────────────────────────────────────────────────────────────
  const bar = el('div', 'cs-bar');
  const title = el('input', 'cs-title');
  title.type = 'text';
  title.placeholder = 'Title';
  title.setAttribute('aria-label', 'Title');
  title.addEventListener('input', () => { state.story.title = title.value; markDirty(); });
  const status = el('span', 'cs-chip', { text: 'Draft' });
  const words = el('span', 'cs-section-meta');
  const actions = el('div', 'cs-actions');
  const exportBtn = button('Export As Markdown', 'file-down', () => void exportMarkdown());
  exportBtn.title = 'Save the whole story as a Markdown file, a heading per chapter';
  const chapterBtn = button('New Chapter', 'bookmark', () => addChapter());
  chapterBtn.title = 'Start the next chapter; new beats go there';
  actions.append(exportBtn, chapterBtn);
  bar.append(title, status, words, actions);
  root.appendChild(bar);
  const errorLine = el('div', 'cs-error');
  errorLine.style.display = 'none';
  root.appendChild(errorLine);

  // ── Brief ──────────────────────────────────────────────────────────────
  const brief = section('Brief', 'Premise, setting, cast, style, point of view. The writer reads it every beat.');
  root.appendChild(brief.root);
  const b = state.story.brief;
  const premise = textarea('Premise', 'What the story is about, in a sentence or three.', 3, (v) => { state.story.brief.premise = v; });
  const premiseRoll = deps.tableRoll ? deps.tableRoll(premise.area) : null;
  if (premiseRoll) {
    const labelRow = el('div', 'cs-labelrow');
    premise.field.insertBefore(labelRow, premise.field.firstChild);
    labelRow.append(premise.field.querySelector('.cs-label'), premiseRoll);
  }
  const grid = el('div', 'st-grid');
  const genre = inputField('Genre', 'e.g. quiet drama, space opera, cosy mystery', (v) => { state.story.brief.genre = v; });
  const setting = inputField('Setting', 'Where and when', (v) => { state.story.brief.setting = v; });
  const style = inputField('Style', 'e.g. spare and dry, lush, close and nervous', (v) => { state.story.brief.style = v; });
  grid.append(genre.field, setting.field, style.field);
  const selects = el('div', 'st-grid');
  const povSel = selectField('Point Of View', POVS.map((p) => ({ value: p.value, label: p.label })), b.pov, (v) => { state.story.brief.pov = v; markDirty(); });
  const tenseSel = selectField('Tense', TENSES.map((t) => ({ value: t.value, label: t.label })), b.tense, (v) => { state.story.brief.tense = v; markDirty(); });
  const lengthSel = selectField('Beat Length', BEAT_LENGTHS.map((l) => ({ value: l.value, label: `${l.label} (about ${l.words} words)` })), b.beatLength, (v) => { state.story.brief.beatLength = v; markDirty(); });
  selects.append(povSel.field, tenseSel.field, lengthSel.field);
  const castField = el('div', 'cs-field');
  castField.appendChild(el('div', 'cs-label', { text: 'Cast' }));
  const castRow = el('div', 'st-cast');
  const castAdd = tgSelect(parallx, { layout: 'inline', title: 'Add a character from your roster', items: [{ value: '', label: 'Add Character' }], value: '', onChange: (v) => { if (v) { void addCast(v); } } });
  castField.append(castRow);
  const castHint = el('div', 'cs-hint', { text: 'Characters from the Studio. The writer gets their portrait, voice and drives.' });
  castField.append(castHint);
  const note = textarea("Author's Note", 'Holds for every beat, e.g. "No storms until chapter three." or "Keep the dog alive."', 2, (v) => { state.story.brief.authorsNote = v; });
  const engine = el('div', 'cs-engine');
  engine.appendChild(el('span', null, { text: 'Model' }));
  const modelSelect = tgSelect(parallx, { layout: 'flex', onChange: (v) => { state.engine.modelId = v || ''; void persistEngine({ storyModelId: v || '' }); } });
  engine.appendChild(modelSelect.element);
  engine.appendChild(el('span', null, { text: 'Context' }));
  const ctxSelect = tgSelect(parallx, { layout: 'ctx', title: 'Context window for story beats', items: (deps.ctxPresets || []).map((p) => ({ value: String(p.value), label: p.label })), onChange: (v) => { state.engine.numCtx = Number(v) || 0; void persistEngine({ storyContextWindow: Number(v) || 0 }); } });
  engine.appendChild(ctxSelect.element);
  brief.body.append(premise.field, grid, selects, castField, note.field, engine);

  // ── Memory ─────────────────────────────────────────────────────────────
  const memory = section('Story Memory', 'What has happened, kept short so the writer never forgets past its context.', true);
  root.appendChild(memory.root);
  const memoryArea = el('textarea', 'cs-textarea st-memory');
  memoryArea.rows = 4;
  memoryArea.placeholder = 'Written from the beats as they go. Edit it if the writer got something wrong.';
  memoryArea.setAttribute('aria-label', 'Story memory');
  memoryArea.addEventListener('input', () => { state.story.memory = memoryArea.value; autogrow(memoryArea); markDirty(); });
  const memoryActions = el('div', 'cs-actions');
  const memoryBtn = button('Update Memory', 'brain', () => void updateMemory(true));
  memoryBtn.title = 'Fold every beat since the last update into the memory now';
  memoryActions.appendChild(memoryBtn);
  memory.body.append(memoryArea, memoryActions);

  // ── Chapters and beats ─────────────────────────────────────────────────
  const chaptersHost = el('div');
  root.appendChild(chaptersHost);

  // ── Composer ───────────────────────────────────────────────────────────
  const composer = el('div', 'st-composer');
  const direction = el('input', 'cs-input');
  direction.type = 'text';
  direction.placeholder = 'Direction for the next beat, if any';
  direction.setAttribute('aria-label', 'Direction for the next beat');
  direction.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void writeBeat(); } });
  const continueBtn = button('Continue', 'sparkles', () => void writeBeat(), true);
  continueBtn.title = 'Write the next beat';
  const stopBtn = button('Stop', 'square', () => { state.stop = true; });
  stopBtn.style.display = 'none';
  composer.append(direction, continueBtn, stopBtn);
  root.appendChild(composer);

  // ── Helpers ────────────────────────────────────────────────────────────
  function button(label, iconName, onClick, primary = false) {
    const btn = el('button', `cs-btn${primary ? ' cs-btn--primary' : ''}`, { html: `${icon(iconName, 14)}<span>${label}</span>` });
    btn.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return btn;
  }
  function iconButton(iconName, hint, onClick) {
    const btn = el('button', 'cs-icon-btn', { html: icon(iconName, 14) });
    btn.title = hint;
    btn.setAttribute('aria-label', hint);
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return btn;
  }
  function section(name, meta, closed = false) {
    const sroot = el('div', `cs-section${closed ? ' cs-section--closed' : ''}`);
    const shead = el('div', 'cs-section-head');
    const m = el('span', 'cs-section-meta', { text: meta });
    shead.append(el('span', 'cs-section-chev', { html: icon('chevron-down', 14) }), el('span', 'cs-section-title', { text: name }), m);
    const body = el('div', 'cs-section-body');
    sroot.append(shead, body);
    shead.addEventListener('click', () => sroot.classList.toggle('cs-section--closed'));
    return { root: sroot, body, meta: m, open: () => sroot.classList.remove('cs-section--closed'), close: () => sroot.classList.add('cs-section--closed'), setMeta: (t) => { m.textContent = t; } };
  }
  function autogrow(area) { area.style.height = 'auto'; area.style.height = `${Math.max(area.scrollHeight, 34)}px`; }
  function textarea(label, placeholder, rows, onInput) {
    const field = el('div', 'cs-field');
    field.appendChild(el('div', 'cs-label', { text: label }));
    const area = el('textarea', 'cs-textarea');
    area.rows = rows;
    area.placeholder = placeholder;
    area.setAttribute('aria-label', label);
    area.addEventListener('input', () => { onInput(area.value); autogrow(area); markDirty(); });
    field.appendChild(area);
    return { field, area };
  }
  function inputField(label, placeholder, onInput) {
    const field = el('div', 'cs-field');
    field.appendChild(el('div', 'cs-label', { text: label }));
    const inp = el('input', 'cs-input');
    inp.type = 'text';
    inp.placeholder = placeholder;
    inp.setAttribute('aria-label', label);
    inp.addEventListener('input', () => { onInput(inp.value); markDirty(); });
    field.appendChild(inp);
    return { field, input: inp };
  }
  function selectField(label, items, value, onChange) {
    const field = el('div', 'cs-field');
    field.appendChild(el('div', 'cs-label', { text: label }));
    const sel = tgSelect(parallx, { layout: 'full', items, value, onChange });
    field.appendChild(sel.element);
    return { field, select: sel };
  }
  function setStatus(text, tone = '') { status.textContent = text; status.className = `cs-chip${tone ? ` cs-chip--${tone}` : ''}`; }
  function showError(message, retry) {
    errorLine.replaceChildren(el('span', null, { text: message }));
    if (retry) { const b = button('Try Again', 'refresh-cw', retry); b.classList.add('cs-btn--small'); errorLine.appendChild(b); }
    errorLine.style.display = '';
  }
  function clearError() { errorLine.style.display = 'none'; errorLine.replaceChildren(); }
  function refreshWords() {
    const n = storyWords(state.story);
    const ch = state.story.chapters.length;
    words.textContent = n ? `${n.toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'} · ${ch} ${ch === 1 ? 'chapter' : 'chapters'}` : '';
  }

  // ── Cast ───────────────────────────────────────────────────────────────
  function renderCast() {
    castRow.replaceChildren();
    for (const c of state.story.brief.cast) {
      const chip = el('span', 'cs-chip cs-chip--accent', { text: c.name });
      chip.title = c.tagline || c.portrait || '';
      chip.appendChild(iconButton('x', `Remove ${c.name} from the cast`, () => { state.story.brief.cast = state.story.brief.cast.filter((x) => x !== c); renderCast(); markDirty(); }));
      castRow.appendChild(chip);
    }
    castRow.appendChild(castAdd.element);
    castHint.style.display = state.story.brief.cast.length ? 'none' : '';
  }
  async function loadCharacters() {
    try { state.characters = await deps.scanCharacters(fs, workspaceUri); } catch { state.characters = []; }
    const items = [{ value: '', label: state.characters.length ? 'Add Character' : 'No characters yet' }, ...state.characters.map((c) => ({ value: c.fileName, label: c.frontmatter?.name || c.fileName }))];
    castAdd.setItems(items);
    castAdd.value = '';
  }
  async function addCast(fileName) {
    const c = state.characters.find((x) => x.fileName === fileName);
    castAdd.value = '';
    if (!c || state.story.brief.cast.some((x) => x.fileName === fileName)) return;
    state.story.brief.cast.push(castEntryFromCharacter(fileName, c.rawData || {}));
    renderCast();
    markDirty();
  }

  // ── Chapters and beats ─────────────────────────────────────────────────
  const beatEls = new Map();
  function renderChapters() {
    chaptersHost.replaceChildren();
    beatEls.clear();
    const story = state.story;
    if (story.chapters.length === 0) story.chapters.push({ id: `ch-${deps.generateId().slice(0, 6)}`, title: 'Chapter 1' });
    for (const ch of story.chapters) {
      const wrap = el('div', 'st-chapter');
      const chead = el('div', 'st-chapter-head');
      const ctitle = el('input', 'st-chapter-title');
      ctitle.type = 'text';
      ctitle.value = ch.title;
      ctitle.placeholder = 'Chapter';
      ctitle.setAttribute('aria-label', 'Chapter title');
      ctitle.addEventListener('input', () => { ch.title = ctitle.value; markDirty(); });
      const beats = story.beats.filter((x) => x.chapterId === ch.id);
      const n = beats.reduce((s, x) => s + countWords(x.text), 0);
      const cmeta = el('span', 'st-chapter-meta', { text: beats.length ? `${beats.length} ${beats.length === 1 ? 'beat' : 'beats'} · ${n.toLocaleString('en-US')} words` : 'No beats yet' });
      chead.append(ctitle, cmeta);
      if (beats.length === 0 && story.chapters.length > 1) {
        chead.appendChild(iconButton('trash', 'Remove this empty chapter', () => { story.chapters = story.chapters.filter((c) => c !== ch); renderChapters(); markDirty(); }));
      }
      wrap.appendChild(chead);
      const list = el('div', 'st-beats');
      for (const beat of beats) list.appendChild(beatEl(beat));
      wrap.appendChild(list);
      chaptersHost.appendChild(wrap);
    }
    if (story.beats.length === 0) {
      chaptersHost.appendChild(el('div', 'st-empty', { text: 'Nothing written yet. Fill the brief, then Continue writes the first beat.' }));
    }
    refreshWords();
  }
  function beatEl(beat) {
    const wrap = el('div', 'st-beat');
    wrap.dataset.id = beat.id;
    const area = el('textarea', 'st-beat-text');
    area.value = beat.text;
    area.setAttribute('aria-label', 'Beat');
    area.addEventListener('input', () => { beat.text = area.value; autogrow(area); hideUndo(beat.id); markDirty(); refreshWords(); });
    const acts = el('div', 'st-beat-actions');
    const undoBtn = iconButton('undo-2', 'Undo the last rewrite of this beat', () => undoRewrite(beat.id));
    undoBtn.style.display = 'none';
    const rewriteBtn = iconButton('refresh-cw', 'Rewrite this beat, with a direction if you like', () => toggleSteer(beat.id));
    const delBtn = iconButton('trash', 'Delete this beat', () => { state.story.beats = state.story.beats.filter((x) => x !== beat); renderChapters(); markDirty(); });
    acts.append(undoBtn, rewriteBtn, delBtn);
    const steer = el('div', 'st-beat-steer');
    steer.style.display = 'none';
    const steerInput = el('input', 'cs-input');
    steerInput.type = 'text';
    steerInput.placeholder = 'How it should change, e.g. "slower, she notices the door first"';
    steerInput.setAttribute('aria-label', 'How the beat should change');
    const go = button('Rewrite', 'sparkles', () => void rewriteBeat(beat.id, steerInput.value));
    go.classList.add('cs-btn--small');
    const cancel = button('Cancel', 'x', () => { steer.style.display = 'none'; });
    cancel.classList.add('cs-btn--small', 'cs-btn--quiet');
    steerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } if (e.key === 'Escape') cancel.click(); });
    steer.append(steerInput, go, cancel);
    const err = el('div', 'st-beat-error');
    err.style.display = 'none';
    wrap.append(area, acts, steer, err);
    beatEls.set(beat.id, { wrap, area, undoBtn, steer, steerInput, err });
    queueMicrotask(() => autogrow(area));
    return wrap;
  }
  function toggleSteer(id) {
    const r = beatEls.get(id);
    if (!r) return;
    const open = r.steer.style.display === 'none';
    r.steer.style.display = open ? '' : 'none';
    r.wrap.classList.toggle('st-beat--rewriting', open);
    if (open) r.steerInput.focus();
  }
  function showUndo(id) { const r = beatEls.get(id); if (r) { r.undoBtn.style.display = ''; r.wrap.classList.add('st-beat--undo'); } }
  function hideUndo(id) { const r = beatEls.get(id); if (r) { r.undoBtn.style.display = 'none'; r.wrap.classList.remove('st-beat--undo'); } state.undo.delete(id); }
  function undoRewrite(id) {
    if (!state.undo.has(id)) return;
    const beat = state.story.beats.find((x) => x.id === id);
    const r = beatEls.get(id);
    if (!beat || !r) return;
    beat.text = state.undo.get(id);
    r.area.value = beat.text;
    autogrow(r.area);
    hideUndo(id);
    markDirty();
    refreshWords();
  }
  function beatError(id, message, retry) {
    const r = beatEls.get(id);
    if (!r) return;
    r.err.replaceChildren(el('span', null, { text: message }));
    if (retry) { const b = button('Try Again', 'refresh-cw', retry); b.classList.add('cs-btn--small'); r.err.appendChild(b); }
    r.err.style.display = '';
  }
  function addChapter() {
    const n = state.story.chapters.length + 1;
    state.story.chapters.push({ id: `ch-${deps.generateId().slice(0, 6)}`, title: `Chapter ${n}` });
    renderChapters();
    markDirty();
  }

  // ── Model ──────────────────────────────────────────────────────────────
  async function persistEngine(updates) {
    try { const cur = await deps.loadSettings(fs, workspaceUri); await deps.saveSettings(fs, workspaceUri, { ...cur, ...updates }); } catch (err) { console.warn('[Creations] engine pick not saved:', err); }
  }
  async function loadEngine() {
    try {
      const settings = await deps.loadSettings(fs, workspaceUri);
      const models = await parallx.lm.getModels();
      if (!models.length) modelSelect.setItems([{ value: '', label: 'No Models Available' }]);
      else {
        modelSelect.setItems(models.map((m) => ({ value: m.id, label: m.displayName || m.id })));
        const preferred = [settings.storyModelId, settings.defaultModel].find((id) => id && models.some((m) => m.id === id));
        modelSelect.value = preferred || models[0].id;
      }
      ctxSelect.value = String(settings.storyContextWindow || 0);
      state.engine.modelId = modelSelect.value || '';
      state.engine.numCtx = Number(ctxSelect.value) || 0;
    } catch (err) { console.warn('[Creations] model list failed:', err); }
  }
  async function resolveModel() {
    const settings = await deps.loadSettings(fs, workspaceUri);
    const models = await parallx.lm.getModels();
    const picked = state.engine.modelId || modelSelect.value || '';
    const modelId = (picked && models.some((m) => m.id === picked)) ? picked
      : (settings.defaultModel && models.some((m) => m.id === settings.defaultModel)) ? settings.defaultModel
        : models[0]?.id;
    if (!modelId) throw new Error('No model is available. Choose one in Settings.');
    const ctxPick = state.engine.numCtx || Number(ctxSelect.value) || 0;
    return { modelId, numCtx: ctxPick > 0 ? ctxPick : (settings.defaultContextWindow || undefined) };
  }
  async function streamText(modelId, numCtx, messages, onPartial, options = {}) {
    const stream = parallx.lm.sendChatRequest(modelId, messages, { temperature: 0.85, think: false, numCtx, ...options });
    let text = '';
    for await (const chunk of stream) {
      if (state.disposed || state.stop) break;
      if (chunk && chunk.content) { text += chunk.content; if (onPartial) onPartial(text); }
    }
    return text;
  }

  // ── Writing ────────────────────────────────────────────────────────────
  async function writeBeat() {
    if (state.busy) return;
    clearError();
    const br = state.story.brief;
    if (!br.premise.trim() && state.story.beats.length === 0) { showError('Give the brief a premise first.'); premise.area.focus(); return; }
    state.busy = true;
    state.stop = false;
    continueBtn.disabled = true;
    stopBtn.style.display = '';
    setStatus('Writing', 'accent');
    const chapter = state.story.chapters[state.story.chapters.length - 1];
    const beat = { id: `beat-${deps.generateId().slice(0, 8)}`, text: '', instruction: direction.value.trim(), chapterId: chapter.id, createdAt: Date.now() };
    const live = el('div', 'st-beat st-beat--live');
    const liveText = el('div', 'st-beat-text');
    live.appendChild(liveText);
    const lastChapter = chaptersHost.querySelectorAll('.st-beats');
    const target = lastChapter[lastChapter.length - 1];
    chaptersHost.querySelector('.st-empty')?.remove();
    if (target) target.appendChild(live); else chaptersHost.appendChild(live);
    try {
      const { modelId, numCtx } = await resolveModel();
      const messages = buildBeatMessages({ story: state.story, instruction: beat.instruction, mode: 'continue' });
      const text = await streamText(modelId, numCtx, messages, (t) => { liveText.textContent = stripDashes(t); });
      const clean = cleanBeat(text);
      if (!clean) throw new Error('Nothing came back.');
      beat.text = clean;
      state.story.beats.push(beat);
      direction.value = '';
      brief.close();
      renderChapters();
      scheduleSave(true);
      if (state.story.beats.length - (state.story.memoryAt || 0) >= MEMORY_EVERY) void updateMemory(false);
    } catch (err) {
      live.remove();
      if (state.story.beats.length === 0) renderChapters();
      showError(`Could not write the beat: ${err?.message || String(err)}`, () => void writeBeat());
    } finally {
      state.busy = false;
      state.stop = false;
      continueBtn.disabled = false;
      stopBtn.style.display = 'none';
      refreshStatus();
    }
  }
  async function rewriteBeat(id, instruction) {
    if (state.busy) return;
    const beat = state.story.beats.find((x) => x.id === id);
    const r = beatEls.get(id);
    if (!beat || !r) return;
    state.busy = true;
    state.stop = false;
    r.steer.style.display = 'none';
    r.wrap.classList.add('st-beat--rewriting');
    r.err.style.display = 'none';
    setStatus('Rewriting', 'accent');
    const previous = beat.text;
    try {
      const { modelId, numCtx } = await resolveModel();
      const messages = buildBeatMessages({ story: state.story, instruction, mode: 'rewrite', target: beat });
      const text = await streamText(modelId, numCtx, messages, (t) => { r.area.value = stripDashes(t); autogrow(r.area); });
      const clean = cleanBeat(text);
      if (!clean) throw new Error('Nothing came back.');
      beat.text = clean;
      r.area.value = clean;
      autogrow(r.area);
      state.undo.set(id, previous);
      showUndo(id);
      markDirty();
      refreshWords();
    } catch (err) {
      beat.text = previous;
      r.area.value = previous;
      autogrow(r.area);
      beatError(id, `Could not rewrite: ${err?.message || String(err)}`, () => void rewriteBeat(id, instruction));
    } finally {
      state.busy = false;
      state.stop = false;
      r.wrap.classList.remove('st-beat--rewriting');
      refreshStatus();
    }
  }
  // The memory runs on its own: by hand it holds the composer, after a beat
  // it works quietly while the writer reads.
  let memoryBusy = false;
  async function updateMemory(byHand) {
    if (memoryBusy || (state.busy && byHand)) return;
    const since = state.story.memoryAt || 0;
    if (state.story.beats.length <= since && !byHand) return;
    memoryBusy = true;
    if (byHand) state.busy = true;
    memoryBtn.disabled = true;
    setStatus('Updating Memory', 'accent');
    try {
      const { modelId, numCtx } = await resolveModel();
      const raw = await streamText(modelId, numCtx, buildMemoryMessages(state.story, since), null, { temperature: 0.2, format: 'json' });
      const parsed = parseJsonLoose(raw);
      const mem = parsed && typeof parsed.memory === 'string' ? stripDashes(parsed.memory).trim() : '';
      if (!mem) throw new Error('Nothing came back.');
      state.story.memory = mem;
      state.story.memoryAt = state.story.beats.length;
      memoryArea.value = mem;
      autogrow(memoryArea);
      memory.setMeta(`As of beat ${state.story.memoryAt}.`);
      scheduleSave(true);
    } catch (err) {
      if (byHand) showError(`Could not update the memory: ${err?.message || String(err)}`, () => void updateMemory(true));
    } finally {
      memoryBusy = false;
      if (byHand) state.busy = false;
      memoryBtn.disabled = false;
      refreshStatus();
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────
  function markDirty() { if (state.disposed) return; state.dirty = true; scheduleSave(); }
  function scheduleSave(now = false) {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { state.saveTimer = null; void save(); }, now ? 0 : AUTOSAVE_MS);
    refreshStatus();
  }
  function refreshStatus() {
    if (state.busy) return;
    if (!state.fileName && !state.dirty) { setStatus('Draft'); return; }
    if (state.dirty || state.saveTimer) { setStatus('Saving'); return; }
    setStatus('Saved', 'ok');
  }
  async function save() {
    if (!state.dirty) { refreshStatus(); return; }
    const created = !state.fileName;
    try {
      if (!state.fileName) state.fileName = `${state.story.id}.json`;
      await saveStoryFile(fs, workspaceUri, deps, state.fileName, state.story);
      state.dirty = false;
      if (created) { try { await ctx.onCreated?.(state.fileName); } catch { /* cosmetic */ } }
    } catch (err) {
      showError(`Could not save: ${err?.message || String(err)}`, () => void save());
    }
    refreshStatus();
  }
  async function exportMarkdown() {
    await deps.exportMarkdown(storyFileName(state.story), storyMarkdown(state.story), state.story.title || 'story');
  }

  // ── Load ───────────────────────────────────────────────────────────────
  async function load() {
    if (ctx.fileName) {
      try {
        const { content } = await fs.readFile(deps.resolveUri(workspaceUri, `${deps.extRoot}/${STORIES_DIR}/${ctx.fileName}`));
        const parsed = JSON.parse(content);
        state.story = { ...newStory(parsed.id || `story-${deps.generateId().slice(0, 8)}`), ...parsed, brief: { ...emptyBrief(), ...(parsed.brief || {}) } };
      } catch (err) { showError(`Could not open this story: ${err?.message || String(err)}`); return; }
    }
    const s = state.story;
    title.value = s.title;
    premise.area.value = s.brief.premise; autogrow(premise.area);
    genre.input.value = s.brief.genre;
    setting.input.value = s.brief.setting;
    style.input.value = s.brief.style;
    povSel.select.value = s.brief.pov;
    tenseSel.select.value = s.brief.tense;
    lengthSel.select.value = s.brief.beatLength;
    note.area.value = s.brief.authorsNote; autogrow(note.area);
    memoryArea.value = s.memory; autogrow(memoryArea);
    if (s.memoryAt) memory.setMeta(`As of beat ${s.memoryAt}.`);
    renderCast();
    renderChapters();
    if (s.beats.length > 0) brief.close();
    state.dirty = false;
    refreshStatus();
    await loadCharacters();
    await loadEngine();
    if (!ctx.fileName) title.focus();
  }
  void load();

  return {
    /** Forget unsaved edits: the file is being deleted, nothing must write it back. */
    abandon() {
      state.dirty = false;
      if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    },
    dispose() {
      state.disposed = true;
      state.stop = true;
      if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
      if (state.dirty) void save();
      root.remove();
    },
    __state: state,
  };
}
