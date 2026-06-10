// rowPropertiesSection.ts — the database-properties block shown at the top of
// a ROW opened as a page (Notion parity: a row's page shows its database
// properties under the title, each as `icon + name | value`, click-to-edit,
// above the free-form content).

import type { IDisposable } from '../../../platform/lifecycle.js';
import { DisposableStore } from '../../../platform/lifecycle.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import { createPropertyEditor, createTypeIconElement } from '../properties/propertyEditors.js';
import type { IPropertyDefinition } from '../properties/propertyTypes.js';
import { PILL_COLORS } from './databaseEditorPane.js';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function asDefinition(prop: IDatabaseProperty): IPropertyDefinition {
  return { name: prop.name, type: prop.type, config: prop.config, sortOrder: prop.sortOrder, createdAt: '', updatedAt: '' };
}

function pillEl(text: string, color: string): HTMLElement {
  return el('span', `canvas-db-pill canvas-db-pill--${(PILL_COLORS as readonly string[]).includes(color) ? color : 'default'}`, text);
}

function optionColor(prop: IDatabaseProperty, value: string): string {
  const options = (prop.config as { options?: { value: string; color?: string }[] }).options ?? [];
  return options.find((o) => o.value === value)?.color ?? 'default';
}

/**
 * Mount the row-properties section for `pageId` into `host` (prepended).
 * Resolves to null when the page is not a database row.
 */
export async function mountRowPropertiesSection(
  host: HTMLElement,
  pageId: string,
  db: DatabaseDataService,
  /** Insert before this element (the editor content) — Notion order is
   *  title, properties, content. Falls back to prepending into host. */
  beforeEl?: HTMLElement | null,
): Promise<IDisposable | null> {
  const databaseIds = await db.listDatabasesForPage(pageId);
  const databaseId = databaseIds[0];
  if (!databaseId) return null;

  const disposables = new DisposableStore();
  const root = el('div', 'canvas-db-rowprops');
  if (beforeEl && beforeEl.parentElement) beforeEl.parentElement.insertBefore(root, beforeEl);
  else host.prepend(root);

  let disposed = false;
  const render = async (): Promise<void> => {
    const [props, values] = await Promise.all([
      db.listProperties(databaseId),
      db.getRowValues(databaseId, pageId),
    ]);
    if (disposed) return;
    root.textContent = '';
    for (const prop of props) {
      const row = el('div', 'canvas-db-rowprops__row');
      const name = el('div', 'canvas-db-rowprops__name');
      name.appendChild(createTypeIconElement(prop.type, 14));
      name.appendChild(el('span', '', prop.name));
      row.appendChild(name);

      const valueEl = el('div', 'canvas-db-rowprops__value');
      const value = values[prop.id];
      const renderValue = (): void => {
        valueEl.textContent = '';
        if (prop.type === 'checkbox') {
          const box = el('div', `canvas-db-check${value ? ' canvas-db-check--on' : ''}`);
          box.addEventListener('click', (e) => {
            e.stopPropagation();
            void db.setCellValue(databaseId, pageId, prop.id, !value);
          });
          valueEl.appendChild(box);
          return;
        }
        if (prop.type === 'select' && typeof value === 'string' && value) {
          valueEl.appendChild(pillEl(value, optionColor(prop, value)));
        } else if (prop.type === 'tags' && Array.isArray(value) && value.length > 0) {
          for (const v of value) valueEl.appendChild(pillEl(String(v), optionColor(prop, String(v))));
        } else if (value !== null && value !== undefined && value !== '') {
          valueEl.textContent = Array.isArray(value) ? value.join(', ') : String(value);
        } else {
          valueEl.appendChild(el('span', 'canvas-db-rowprops__empty', 'Empty'));
        }
      };
      renderValue();
      if (prop.type !== 'checkbox') {
        valueEl.addEventListener('click', () => {
          valueEl.textContent = '';
          const editor = createPropertyEditor(asDefinition(prop), value ?? null, (next) => {
            void db.setCellValue(databaseId, pageId, prop.id, next);
          });
          valueEl.appendChild(editor);
          (editor.querySelector('input') as HTMLElement | null)?.focus();
        }, { once: true });
      }
      row.appendChild(valueEl);
      root.appendChild(row);
    }
  };

  disposables.add(db.onDidChangeRows((id) => { if (id === databaseId) void render(); }));
  disposables.add(db.onDidChangeStructure((id) => { if (id === databaseId) void render(); }));
  await render();

  return {
    dispose: () => {
      disposed = true;
      disposables.dispose();
      root.remove();
    },
  };
}
