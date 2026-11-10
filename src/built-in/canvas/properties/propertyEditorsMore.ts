// propertyEditorsMore.ts — editors for the round-2 property types
// (docs/DATABASES.md step 3), built with the kit.
//
//   files             a list of the files kept, Add File… (the system's open
//                     dialog, copied into .parallx/media) and a link field
//   created time, last edited time, ID, formula, rollup
//                     read-only: what the row computes, shown as a value
//
// Status, email and phone reuse the select and text editors in
// propertyEditors.ts (createPropertyEditor routes them).

import { createBlock, createButton, createIconButton, createInput } from '../../../ui/kit.js';
import { addDisposableListener, attachPopupDismiss, layoutPopup } from '../../../ui/dom.js';
import type { IRelationEditorHost } from './propertyEditors.js';
import type { IPropertyDefinition } from './propertyTypes.js';
import { filesOf, renderCellValue, type IStoredFile } from '../database/cellRender.js';
import { storeWorkspaceFile } from '../imageStore.js';

type FileBridge = {
  dialog?: { openFile?(options?: { multiSelect?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null> };
  fs?: { readFile?(path: string, encoding: string): Promise<unknown> };
};

/** The row the renderers take, from an editor's definition (only type and config matter to them). */
function asProperty(definition: IPropertyDefinition): { id: string; databaseId: string; name: string; type: IPropertyDefinition['type']; config: Record<string, unknown>; sortOrder: number } {
  return { id: '', databaseId: '', name: definition.name, type: definition.type, config: definition.config, sortOrder: 0 };
}

/** A computed property's value, read-only. */
export function createReadOnlyEditor(definition: IPropertyDefinition, value: unknown): HTMLElement {
  const box = createBlock(null, 'div', { className: 'canvas-prop-readonly', attrs: { 'aria-readonly': 'true', role: 'textbox', 'aria-label': definition.name } });
  if (!renderCellValue(box, asProperty(definition), value)) createBlock(box, 'span', { className: 'canvas-prop-readonly__empty', text: 'Empty' });
  return box;
}

/** Pick files with the system dialog and keep them in the workspace; the links to them, in order. */
export async function pickAndStoreFiles(): Promise<IStoredFile[]> {
  const bridge = (globalThis as { parallxElectron?: FileBridge }).parallxElectron;
  const paths = await bridge?.dialog?.openFile?.({ multiSelect: true }).catch(() => null);
  if (!paths || paths.length === 0 || !bridge?.fs?.readFile) return [];
  const out: IStoredFile[] = [];
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop() || 'file';
    const read = await bridge.fs.readFile(p, 'base64').catch(() => null) as unknown;
    const base64 = typeof read === 'string' ? read : (read && typeof read === 'object' && typeof (read as { data?: unknown }).data === 'string' ? (read as { data: string }).data : null);
    if (!base64) continue;
    const src = await storeWorkspaceFile(name, base64);
    if (src) out.push({ name, src });
  }
  return out;
}

/** The files editor: each file as a chip with a remove, then Add File… and a link field. */
export function createFilesEditor(definition: IPropertyDefinition, value: unknown, onChange: (v: unknown) => void): HTMLElement {
  const root = createBlock(null, 'div', { className: 'canvas-prop-files' });
  let files = filesOf(value);
  const list = createBlock(root, 'div', { className: 'canvas-prop-files__list' });
  const render = (): void => {
    list.textContent = '';
    if (files.length === 0) createBlock(list, 'span', { className: 'canvas-prop-files__empty', text: 'No files' });
    for (const f of files) {
      const chip = createBlock(list, 'span', { className: 'canvas-prop-files__chip' });
      const shown = createBlock(chip, 'span', { className: 'canvas-prop-files__one' });
      renderCellValue(shown, asProperty(definition), [f]);
      createIconButton(chip, { id: null, icon: 'x', title: `Remove ${f.name}`, size: 'sm', onClick: () => { files = files.filter((x) => x !== f); onChange(files); render(); } })
        .classList.add('canvas-prop-files__remove');
    }
  };
  render();
  const actions = createBlock(root, 'div', { className: 'canvas-prop-files__actions' });
  createButton(actions, { id: null, label: 'Add File…', icon: 'upload', kind: 'ghost', size: 'sm', onClick: async () => {
    const added = await pickAndStoreFiles();
    if (added.length === 0) return;
    files = [...files, ...added];
    onChange(files);
    render();
  } });
  const link = createInput(actions, { id: null, label: 'Add a link', placeholder: 'Paste a link, Enter to add' });
  link.element.classList.add('canvas-prop-files__link');
  const input = link.element.querySelector<HTMLInputElement>('input') ?? (link.element as HTMLInputElement);
  addDisposableListener(input, 'keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    const src = link.value.trim();
    if (!src) return;
    files = [...files, { name: src.split(/[\\/]/).pop()?.split('?')[0] || src, src }];
    link.value = '';
    onChange(files);
    render();
  });
  return root;
}

// ─── Relation ────────────────────────────────────────────────────────────────

type RelatedItem = { id: string; title: string; icon?: string | null };

/** The ids and titles a relation value carries (stored ids, or the derived {id, title} objects). */
function relatedItems(value: unknown): RelatedItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? { id: v, title: v } : (v && typeof v === 'object' && typeof (v as RelatedItem).id === 'string' ? { id: (v as RelatedItem).id, title: String((v as RelatedItem).title ?? (v as RelatedItem).id) } : null)))
    .filter((x): x is RelatedItem => !!x);
}

/**
 * The relation editor: the linked pages as chips (each with a remove), and
 * Link… which opens a search over the related database's rows; a title with
 * no match can be made as a new row there.
 */
export function createRelationEditor(definition: IPropertyDefinition, value: unknown, onChange: (v: unknown) => void, host?: IRelationEditorHost): HTMLElement {
  const root = createBlock(null, 'div', { className: 'canvas-prop-relation' });
  const targetId = typeof definition.config['databaseId'] === 'string' ? definition.config['databaseId'] : '';
  let items = relatedItems(value);
  const list = createBlock(root, 'div', { className: 'canvas-prop-relation__list' });
  const commit = (): void => onChange(items.map((i) => i.id));
  const render = (): void => {
    list.textContent = '';
    if (items.length === 0) createBlock(list, 'span', { className: 'canvas-prop-files__empty', text: 'No links' });
    for (const it of items) {
      const chip = createBlock(list, 'span', { className: 'canvas-prop-relation__chip' });
      if (host?.openPage) createButton(chip, { id: null, label: it.title, kind: 'ghost', size: 'sm', icon: 'file', onClick: () => host.openPage!(it.id) }).classList.add('canvas-prop-relation__open');
      else createBlock(chip, 'span', { className: 'canvas-prop-relation__title', text: it.title });
      createIconButton(chip, { id: null, icon: 'x', title: `Unlink ${it.title}`, size: 'sm', onClick: () => { items = items.filter((x) => x.id !== it.id); commit(); render(); } }).classList.add('canvas-prop-files__remove');
    }
  };
  render();
  if (!host || !targetId) return root;
  const linkBtn = createButton(root, { id: null, label: 'Link…', icon: 'arrow-right-left', kind: 'ghost', size: 'sm', onClick: () => void openPicker() });
  const openPicker = async (): Promise<void> => {
    const rows = await host.listRows(targetId);
    const pop = createBlock(document.body, 'div', { className: 'canvas-db-popover canvas-prop-relation__picker', attrs: { role: 'dialog', 'aria-label': `Link ${definition.name}` } });
    let detach: (() => void) | null = null;
    const close = (): void => { detach?.(); pop.remove(); };
    detach = attachPopupDismiss(pop, close);
    const search = createInput(pop, { id: null, label: 'Search pages', placeholder: 'Search, or type a new name' });
    const results = createBlock(pop, 'div', { className: 'canvas-prop-relation__results', attrs: { role: 'listbox' } });
    const draw = (): void => {
      results.textContent = '';
      const q = search.value.trim().toLowerCase();
      const shown = rows.filter((r) => !q || (r.title || 'Untitled').toLowerCase().includes(q)).slice(0, 50);
      for (const r of shown) {
        const linked = items.some((i) => i.id === r.pageId);
        const b = createButton(results, { id: null, label: r.title || 'Untitled', kind: 'ghost', size: 'sm', icon: linked ? 'check' : 'file', onClick: () => {
          if (linked) items = items.filter((i) => i.id !== r.pageId); else items = [...items, { id: r.pageId, title: r.title || 'Untitled' }];
          commit(); render(); draw();
        } });
        b.classList.add('canvas-prop-relation__result');
        b.setAttribute('aria-pressed', String(linked));
      }
      if (q && !rows.some((r) => (r.title || '').toLowerCase() === q)) {
        createButton(results, { id: null, label: `Create "${search.value.trim()}"`, kind: 'ghost', size: 'sm', icon: 'plus', onClick: async () => {
          const title = search.value.trim();
          const id = await host.createRow(targetId, title);
          rows.push({ pageId: id, title, icon: null });
          items = [...items, { id, title }];
          commit(); render(); search.value = ''; draw();
        } }).classList.add('canvas-prop-relation__result');
      }
      if (shown.length === 0 && !q) createBlock(results, 'div', { className: 'canvas-prop-files__empty', text: 'No rows there yet' });
    };
    const input = search.element.querySelector<HTMLInputElement>('input') ?? (search.element as HTMLInputElement);
    addDisposableListener(input, 'input', draw);
    addDisposableListener(input, 'keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    draw();
    layoutPopup(pop, linkBtn.getBoundingClientRect(), { position: 'below', gap: 4 });
    input.focus();
  };
  return root;
}
