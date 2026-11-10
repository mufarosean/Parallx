// formulaDialog.ts — make or change a formula property (docs/DATABASES.md
// step 6), built with the kit: a name, the expression, a live result on the
// first row, and the properties and functions to insert.

import { createBlock, createButton, createInput } from '../../../ui/kit.js';
import { attachPopupDismiss, layoutPopup } from '../../../ui/dom.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';
import { FORMULA_FUNCTIONS, formulaValue, isFormulaError } from './formula.js';
import { valueText } from './cellRender.js';

export async function showFormulaDialog(
  anchor: HTMLElement, db: DatabaseDataService, databaseId: string, props: readonly IDatabaseProperty[], sampleRow: IDatabaseRow | null,
  existing: IDatabaseProperty | null, onDone: (prop: IDatabaseProperty | null) => void,
): Promise<void> {
  const pop = createBlock(document.body, 'div', { className: 'canvas-db-popover canvas-db-dialog canvas-db-formula', attrs: { role: 'dialog', 'aria-label': existing ? 'Formula' : 'New formula' } });
  createBlock(pop, 'div', { className: 'canvas-db-popover__label', text: existing ? 'Formula' : 'New formula' });
  let detach: (() => void) | null = null;
  const close = (): void => { detach?.(); pop.remove(); };
  detach = attachPopupDismiss(pop, close);

  const nameField = createBlock(pop, 'div', { className: 'canvas-db-dialog__field' });
  createBlock(nameField, 'span', { className: 'canvas-db-dialog__fieldlabel', text: 'Name' });
  const name = createInput(nameField, { id: null, label: 'Property name', placeholder: 'Formula', value: existing?.name ?? '' });
  const exprField = createBlock(pop, 'div', { className: 'canvas-db-dialog__field' });
  createBlock(exprField, 'span', { className: 'canvas-db-dialog__fieldlabel', text: 'Formula' });
  const expr = createInput(exprField, { id: null, label: 'Formula', placeholder: 'prop("Pages") / 10', value: typeof existing?.config['expression'] === 'string' ? (existing.config['expression'] as string) : '' });
  expr.element.classList.add('canvas-db-formula__expr');
  const input = expr.element.querySelector<HTMLInputElement>('input') ?? (expr.element as HTMLInputElement);
  const preview = createBlock(pop, 'div', { className: 'canvas-db-formula__preview', attrs: { 'aria-live': 'polite' } });

  const others = props.filter((p) => p.id !== existing?.id);
  const update = (): void => {
    const text = expr.value;
    if (!text.trim()) { preview.textContent = 'The result shows here'; preview.classList.remove('canvas-db-formula__preview--error'); return; }
    const v = formulaValue(text, (n) => (n.toLowerCase() === 'name' ? (sampleRow?.title ?? '') : sampleRow?.values[others.find((p) => p.name.toLowerCase() === n.toLowerCase())?.id ?? ''] ?? null));
    if (isFormulaError(v)) { preview.textContent = v.error; preview.classList.add('canvas-db-formula__preview--error'); return; }
    preview.classList.remove('canvas-db-formula__preview--error');
    preview.textContent = `= ${v === null ? 'empty' : Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'boolean' ? (v ? 'checked' : 'unchecked') : valueText({ id: '', databaseId: '', name: '', type: typeof v === 'number' ? 'number' : 'text', config: {}, sortOrder: 0 }, v)}${sampleRow ? ` for ${sampleRow.title || 'Untitled'}` : ''}`;
  };
  input.addEventListener('input', update);
  update();

  const insert = (text: string): void => {
    const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
    expr.value = input.value.slice(0, start) + text + input.value.slice(end);
    const at = start + text.length;
    input.focus(); input.setSelectionRange(at, at);
    update();
  };
  const cols = createBlock(pop, 'div', { className: 'canvas-db-formula__cols' });
  const propsCol = createBlock(cols, 'div', { className: 'canvas-db-formula__col' });
  createBlock(propsCol, 'span', { className: 'canvas-db-dialog__fieldlabel', text: 'Properties' });
  const propList = createBlock(propsCol, 'div', { className: 'canvas-db-formula__list' });
  createButton(propList, { id: null, label: 'Name', kind: 'ghost', size: 'sm', icon: 'text', onClick: () => insert('prop("Name")') });
  for (const p of others) createButton(propList, { id: null, label: p.name, kind: 'ghost', size: 'sm', icon: 'hash', title: `prop("${p.name}")`, onClick: () => insert(`prop("${p.name}")`) });
  const fnCol = createBlock(cols, 'div', { className: 'canvas-db-formula__col' });
  createBlock(fnCol, 'span', { className: 'canvas-db-dialog__fieldlabel', text: 'Functions' });
  const fnList = createBlock(fnCol, 'div', { className: 'canvas-db-formula__list' });
  for (const f of FORMULA_FUNCTIONS) createButton(fnList, { id: null, label: f.name, kind: 'ghost', size: 'sm', icon: 'calculator', title: f.hint, onClick: () => insert(`${f.name}(`) });

  const error = createBlock(pop, 'div', { className: 'canvas-db-popover__error' });
  const actions = createBlock(pop, 'div', { className: 'canvas-db-dialog__actions' });
  createButton(actions, { id: null, label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => { close(); onDone(null); } });
  createButton(actions, { id: null, label: existing ? 'Save' : 'Create Formula', icon: 'calculator', kind: 'primary', size: 'sm', onClick: async () => {
    const config = { expression: expr.value.trim() };
    const propName = name.value.trim() || 'Formula';
    try {
      if (existing) { await db.updateProperty(databaseId, existing.id, { name: propName, config }); close(); onDone({ ...existing, name: propName, config }); }
      else { const prop = await db.addProperty(databaseId, propName, 'formula', config); close(); onDone(prop); }
    } catch (err) { error.textContent = err instanceof Error ? err.message : String(err); }
  } });
  layoutPopup(pop, anchor.getBoundingClientRect(), { position: 'below', gap: 4 });
  setTimeout(() => input.focus(), 0);
}
