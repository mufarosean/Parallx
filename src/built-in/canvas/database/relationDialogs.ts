// relationDialogs.ts — the dialogs that make a relation or a rollup property
// (docs/DATABASES.md step 5), built with the kit.
//
//   Relation: a name, the database it points at, and whether the other
//             database shows the link too (a synced relation).
//   Rollup:   a name, which relation to follow, which property to read
//             there, and the function over it.

import { createBlock, createButton, createInput, createToggle } from '../../../ui/kit.js';
import { attachPopupDismiss, layoutPopup } from '../../../ui/dom.js';
import { Dropdown } from '../../../ui/dropdown.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import { createRelationProperty, relationConfig } from './relations.js';
import { rollupOptionsFor, rollupConfig, type RollupKind } from './rollups.js';

function popover(anchor: HTMLElement, title: string): { pop: HTMLElement; close(): void } {
  const pop = createBlock(document.body, 'div', { className: 'canvas-db-popover canvas-db-dialog', attrs: { role: 'dialog', 'aria-label': title } });
  createBlock(pop, 'div', { className: 'canvas-db-popover__label', text: title });
  let detach: (() => void) | null = null;
  const close = (): void => { detach?.(); pop.remove(); };
  detach = attachPopupDismiss(pop, close);
  layoutPopup(pop, anchor.getBoundingClientRect(), { position: 'below', gap: 4 });
  return { pop, close };
}

function field(pop: HTMLElement, label: string): HTMLElement {
  const row = createBlock(pop, 'div', { className: 'canvas-db-dialog__field' });
  createBlock(row, 'span', { className: 'canvas-db-dialog__fieldlabel', text: label });
  return row;
}

/** Make a relation property. Resolves with the property, or null when dismissed. */
export async function showRelationDialog(anchor: HTMLElement, db: DatabaseDataService, databaseId: string, onDone: (prop: IDatabaseProperty | null) => void): Promise<void> {
  const databases = await db.listDatabases();
  const { pop, close } = popover(anchor, 'New relation');
  const name = createInput(field(pop, 'Name'), { id: null, label: 'Property name', placeholder: 'Related to' });
  const targetHost = createBlock(field(pop, 'Related to'), 'div', { className: 'canvas-db-popover__select' });
  const target = new Dropdown(targetHost, { items: databases.map((d) => ({ value: d.id, label: d.title })), selected: databases[0]?.id, ariaLabel: 'Related database', placeholder: 'Choose a database' });
  const syncRow = field(pop, 'Show on the other database too');
  const sync = createToggle(syncRow, { id: null, label: 'Show on the other database too', checked: false });
  const error = createBlock(pop, 'div', { className: 'canvas-db-popover__error' });
  const actions = createBlock(pop, 'div', { className: 'canvas-db-dialog__actions' });
  createButton(actions, { id: null, label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => { target.dispose(); close(); onDone(null); } });
  createButton(actions, { id: null, label: 'Create Relation', icon: 'arrow-right-left', kind: 'primary', size: 'sm', onClick: async () => {
    const targetId = target.value;
    if (!targetId) { error.textContent = 'Choose the database it relates to.'; return; }
    const title = databases.find((d) => d.id === targetId)?.title ?? 'Related';
    try {
      const prop = await createRelationProperty(db, databaseId, name.value.trim() || title, targetId, sync.checked);
      target.dispose(); close(); onDone(prop);
    } catch (err) { error.textContent = err instanceof Error ? err.message : String(err); }
  } });
  setTimeout(() => (name.element.querySelector('input') as HTMLInputElement | null)?.focus(), 0);
}

/** Make or change a rollup property. `existing` edits that one. */
export async function showRollupDialog(anchor: HTMLElement, db: DatabaseDataService, databaseId: string, props: readonly IDatabaseProperty[], existing: IDatabaseProperty | null, onDone: (prop: IDatabaseProperty | null) => void): Promise<void> {
  const relations = props.filter((p) => p.type === 'relation');
  const { pop, close } = popover(anchor, existing ? 'Rollup' : 'New rollup');
  if (relations.length === 0) {
    createBlock(pop, 'div', { className: 'canvas-db-dialog__hint', text: 'A rollup follows a relation. Add a relation property first.' });
    createButton(createBlock(pop, 'div', { className: 'canvas-db-dialog__actions' }), { id: null, label: 'Close', kind: 'ghost', size: 'sm', onClick: () => { close(); onDone(null); } });
    return;
  }
  const current = existing ? rollupConfig(existing) : null;
  const name = createInput(field(pop, 'Name'), { id: null, label: 'Property name', placeholder: 'Rollup', value: existing?.name ?? '' });
  const relHost = createBlock(field(pop, 'Relation'), 'div', { className: 'canvas-db-popover__select' });
  const rel = new Dropdown(relHost, { items: relations.map((p) => ({ value: p.id, label: p.name })), selected: current?.relationId ?? relations[0]!.id, ariaLabel: 'Relation' });
  const propHost = createBlock(field(pop, 'Property'), 'div', { className: 'canvas-db-popover__select' });
  const fnHost = createBlock(field(pop, 'Calculate'), 'div', { className: 'canvas-db-popover__select' });
  let targetProps: IDatabaseProperty[] = [];
  const propSel = new Dropdown(propHost, { items: [], ariaLabel: 'Property to roll up' });
  const fnSel = new Dropdown(fnHost, { items: [], ariaLabel: 'Function' });
  const typeOf = (id: string | undefined): Parameters<typeof rollupOptionsFor>[0] => (!id || id === TITLE_KEY ? 'title' : (targetProps.find((p) => p.id === id)?.type ?? 'text'));
  const syncFns = (): void => {
    const opts = rollupOptionsFor(typeOf(propSel.value));
    const keep = opts.some((o) => o.kind === fnSel.value) ? fnSel.value : (current?.function && opts.some((o) => o.kind === current.function) ? current.function : opts[0]!.kind);
    fnSel.items = opts.map((o) => ({ value: o.kind, label: o.label }));
    fnSel.value = keep;
  };
  const syncProps = async (): Promise<void> => {
    const relation = relations.find((p) => p.id === rel.value);
    const targetId = relation ? relationConfig(relation).databaseId : '';
    targetProps = targetId ? await db.listProperties(targetId) : [];
    propSel.items = [{ value: TITLE_KEY, label: 'Name' }, ...targetProps.filter((p) => p.type !== 'relation' && p.type !== 'rollup').map((p) => ({ value: p.id, label: p.name }))];
    propSel.value = current && propSel.items.some((i) => i.value === current.propertyId) ? current.propertyId : TITLE_KEY;
    syncFns();
  };
  rel.onDidChange(() => void syncProps());
  propSel.onDidChange(syncFns);
  await syncProps();
  const error = createBlock(pop, 'div', { className: 'canvas-db-popover__error' });
  const actions = createBlock(pop, 'div', { className: 'canvas-db-dialog__actions' });
  const dispose = (): void => { rel.dispose(); propSel.dispose(); fnSel.dispose(); close(); };
  createButton(actions, { id: null, label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => { dispose(); onDone(null); } });
  createButton(actions, { id: null, label: existing ? 'Save' : 'Create Rollup', icon: 'sigma', kind: 'primary', size: 'sm', onClick: async () => {
    const config = { relationId: rel.value ?? '', propertyId: propSel.value ?? TITLE_KEY, function: (fnSel.value ?? 'show_original') as RollupKind };
    if (!config.relationId) { error.textContent = 'Choose a relation.'; return; }
    const propName = name.value.trim() || (propSel.items.find((i) => i.value === config.propertyId)?.label ?? 'Rollup');
    try {
      if (existing) { await db.updateProperty(databaseId, existing.id, { name: propName, config }); dispose(); onDone({ ...existing, name: propName, config }); }
      else { const prop = await db.addProperty(databaseId, propName, 'rollup', config); dispose(); onDone(prop); }
    } catch (err) { error.textContent = err instanceof Error ? err.message : String(err); }
  } });
}
