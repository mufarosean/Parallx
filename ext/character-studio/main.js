// Character Studio — a realistic character creator (docs/CHARACTER_STUDIO.md).
//
// While it runs: a Characters list in its own sidebar, an editor tab per
// character, its commands and styles. Turned off, all of it goes. The figure
// (about 30 MB) loads the first time a character opens, not before.

import { CS_CSS } from './styles.js';
import { Store, defaultCharacter } from './store.js';
import { loadFigure } from './figure.js';
import { createCharacterEditor } from './panel.js';

const EDITOR = 'character-studio';
let sheet = null;
let figurePromise = null;

/** The figure, loaded once while the tool runs. */
function figure(api) {
  if (!figurePromise) figurePromise = loadFigure(api).catch((err) => { figurePromise = null; throw err; });
  return figurePromise;
}

export async function activate(api, context) {
  sheet = new CSSStyleSheet();
  sheet.replaceSync(CS_CSS);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  const store = new Store(api);
  const ready = store.open().catch((err) => { console.error('[CharacterStudio] database:', err); throw err; });
  const ctx = {
    get figure() { return figure(api); },
    store, editors: new Map(), current: null,
    onDeleted: (id) => {
      const open = api.editors.openEditors.find((e) => e.id.endsWith(`:${EDITOR}:${id}`));
      if (open) void api.editors.closeEditor(open.id);
    },
  };
  const sub = (d) => context.subscriptions.push(d);

  const openCharacter = (id, name) => api.editors.openEditor({ typeId: EDITOR, title: name || 'Character', icon: 'user', instanceId: id });
  async function newCharacter() {
    await ready;
    const fig = await figure(api);
    const name = await store.freeName('Character');
    const id = await store.create(name, defaultCharacter(fig));
    await openCharacter(id, name);
  }

  sub(api.editors.registerEditorProvider(EDITOR, { createEditorPane: (container, input) => createCharacterEditor(api, ctx, container, input) }));
  sub(api.commands.registerCommand('characterStudio.new', () => newCharacter()));
  sub(api.commands.registerCommand('characterStudio.open', async () => {
    await ready;
    const rows = await store.list();
    if (rows.length) await openCharacter(rows[0].id, rows[0].name); else await newCharacter();
  }));
  // An editor's actions, by character id (or the editor last used)
  const editor = (id) => ctx.editors.get(typeof id === 'string' && id ? id : ctx.current);
  sub(api.commands.registerCommand('characterStudio.undo', (id) => { const e = editor(id); if (e) e.undo(); }));
  sub(api.commands.registerCommand('characterStudio.redo', (id) => { const e = editor(id); if (e) e.redo(); }));
  sub(api.commands.registerCommand('characterStudio.view', (id, action) => { const e = editor(id); if (e) e.view(action); }));
  sub(api.commands.registerCommand('characterStudio.reset', (id, part) => { const e = editor(id); if (e) e.reset(part); }));
  sub(api.commands.registerCommand('characterStudio.export', (id) => { const e = editor(id); if (e) return e.exportNow(); }));
  sub(api.commands.registerCommand('characterStudio.openCharacter', async (id) => { const r = await store.get(id); if (r) await openCharacter(r.id, r.name); }));
  sub(api.commands.registerCommand('characterStudio.characterMenu', async (id) => {
    const r = await store.get(id);
    const anchor = r && [...document.querySelectorAll('.cs-side-row')].find((x) => x.dataset.id === id);
    const more = anchor && anchor.querySelector('.cs-side-more');
    if (!r || !more) return;
    api.ui.createMenu(more, { id: 'character-studio.character-menu', label: `${r.name} actions`, items: [
      { label: 'Open', icon: 'user', onSelect: () => void openCharacter(r.id, r.name) },
      { label: 'Rename…', icon: 'pencil', onSelect: async () => { const v = await api.window.showInputBox({ prompt: 'Name', value: r.name }); if (v && v.trim()) await store.rename(r.id, v.trim()); } },
      { label: 'Delete', icon: 'trash', onSelect: async () => { const row0 = await store.remove(r.id); ctx.onDeleted(r.id); if (row0) api.ui.showUndoToast({ message: `${row0.name} deleted`, undo: () => void store.restore(row0) }); } },
    ] });
  }));
  if (api.keybindings && typeof api.keybindings.register === 'function') {
    const when = `activeEditor == '${EDITOR}'`;
    for (const [key, cmd] of [['Ctrl+Z', 'characterStudio.undo'], ['Ctrl+Y', 'characterStudio.redo'], ['Ctrl+Shift+Z', 'characterStudio.redo']]) {
      try { sub(api.keybindings.register(key, cmd, when)); } catch (err) { console.warn('[CharacterStudio] shortcut not registered:', key, err && err.message); }
    }
  }

  // The Characters list
  sub(api.views.registerViewProvider('characterStudio.characters', {
    createView(container) {
      const block = (parent, tag, className, text, attrs) => api.ui.createBlock(parent, tag, { className, text, attrs });
      const root = block(container, 'div', 'cs-side');
      const head = block(root, 'div', 'cs-side-head');
      api.ui.createSectionLabel(head, 'Characters');
      api.ui.createIconButton(head, { id: 'characterStudio.new', icon: 'plus', title: 'New Character', size: 'sm', command: 'characterStudio.new' });
      const list = block(root, 'div', 'cs-side-list');
      const listReg = api.ui.createList(list, { id: 'character-studio.characters', label: 'Characters', rows: () => [...list.querySelectorAll('.cs-side-row')], selected: () => [] });
      let drawing = 0;
      async function draw() {
        const n = ++drawing;
        let rows = [];
        try { await ready; rows = await store.list(); } catch (err) { list.textContent = `The characters could not be read. ${(err && err.message) || err}`; return; }
        if (n !== drawing) return;
        list.replaceChildren();
        if (!rows.length) {
          const empty = block(list, 'div', 'cs-side-empty');
          api.ui.createEmptyState(empty, { icon: 'user', headline: 'No characters yet.', hint: 'Make one to start shaping a person.', action: { id: 'characterStudio.new.empty', label: 'New Character', command: 'characterStudio.new' } });
          return;
        }
        for (const r of rows) {
          const row = block(list, 'div', 'cs-side-row', undefined, { 'data-id': r.id });
          const open = api.ui.createButton(row, { id: 'character-studio.characters.open', label: r.name, icon: 'user', kind: 'ghost', size: 'md', command: 'characterStudio.openCharacter', args: [r.id] });
          open.classList.add('cs-side-open');
          // The face picture stands in for the icon once there is one
          if (r.thumbnail) { open.classList.add('cs-has-thumb'); block(open, 'img', 'cs-side-thumb', undefined, { alt: '', src: r.thumbnail }); }
          const more = api.ui.createIconButton(row, { id: 'character-studio.characters.more', icon: 'ellipsis', title: `More for ${r.name}`, size: 'sm', command: 'characterStudio.characterMenu', args: [r.id] });
          more.classList.add('cs-side-more');
        }
      }
      const off = store.onDidChange(() => void draw());
      void draw();
      return { dispose() { off.dispose(); listReg.dispose(); root.remove(); } };
    },
  }));

  sub(api.workspace.onDidChangeWorkspace(async () => { await store.open().catch(() => {}); store.changed(); }));
}

export function deactivate() {
  if (sheet) { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet); sheet = null; }
  figurePromise = null;
}
