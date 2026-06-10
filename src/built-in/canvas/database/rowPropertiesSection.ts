// rowPropertiesSection.ts — the database-properties block shown at the top of
// a ROW opened as a page (Notion parity: a row's page shows its database
// properties under the title, each as `icon + name | value`, click-to-edit,
// above the free-form content).
//
// A page can be a member of SEVERAL databases (membership is a table, not the
// tree — e.g. the migrated "Tags" database plus a project database): one
// labeled group renders per membership. Clicking a tags/select pill opens the
// "pages tagged X" popover (M85 parity, rerouted to database rows) listing the
// other member pages with that value.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { DisposableStore } from '../../../platform/lifecycle.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import { applyFilter } from './databaseViewModel.js';
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
 * Mount the row-properties section for `pageId` into `host` (before `beforeEl`).
 * Resolves to null when the page is not a member of any database.
 */
export async function mountRowPropertiesSection(
  host: HTMLElement,
  pageId: string,
  db: DatabaseDataService,
  /** Insert before this element (the editor content) — Notion order is
   *  title, properties, content. Falls back to prepending into host. */
  beforeEl?: HTMLElement | null,
  /** Open a member page from the "pages tagged X" popover. */
  openPage?: (pageId: string) => void,
): Promise<IDisposable | null> {
  // Memberships are LIVE: a page can gain (or lose) database membership while
  // open — e.g. the legacy-property migration or canvas_add_page_to_database —
  // so the section re-resolves on every change event and (un)mounts itself.
  let databaseIds = await db.listDatabasesForPage(pageId);

  const disposables = new DisposableStore();
  const root = el('div', 'canvas-db-rowprops');
  const mountRoot = (): void => {
    if (root.isConnected) return;
    if (beforeEl && beforeEl.parentElement) beforeEl.parentElement.insertBefore(root, beforeEl);
    else host.prepend(root);
  };
  if (databaseIds.length > 0) mountRoot();

  let disposed = false;
  let activePopover: HTMLElement | null = null;
  const closePopover = (): void => { activePopover?.remove(); activePopover = null; };
  disposables.add({ dispose: closePopover });

  /** "Pages tagged X" — other member pages of `databaseId` sharing `value`. */
  const showPagesForValue = async (databaseId: string, prop: IDatabaseProperty, value: string, anchor: HTMLElement): Promise<void> => {
    closePopover();
    const rows = applyFilter(await db.listRows(databaseId), {
      conjunction: 'and',
      rules: [{ propertyId: prop.id, op: 'contains', value }],
    }).filter((r) => r.pageId !== pageId);

    const pop = el('div', 'canvas-db-popover');
    pop.appendChild(el('div', 'canvas-db-popover__label', `Pages with ${prop.name}: ${value}`));
    if (rows.length === 0) {
      pop.appendChild(el('div', 'canvas-db-menuitem', 'No other pages'));
    }
    for (const r of rows.slice(0, 20)) {
      const item = el('button', 'canvas-db-menuitem', r.title || 'Untitled');
      item.addEventListener('click', () => { closePopover(); openPage?.(r.pageId); });
      pop.appendChild(item);
    }
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.min(rect.left, window.innerWidth - pop.offsetWidth - 12)}px`;
    pop.style.top = `${rect.bottom + 4}px`;
    activePopover = pop;
    const onDown = (e: MouseEvent): void => {
      if (!pop.contains(e.target as Node)) {
        document.removeEventListener('mousedown', onDown, true);
        closePopover();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  };

  const render = async (): Promise<void> => {
    const groups = await Promise.all(databaseIds.map(async (databaseId) => ({
      databaseId,
      info: await db.getDatabase(databaseId),
      props: await db.listProperties(databaseId),
      values: await db.getRowValues(databaseId, pageId),
    })));
    if (disposed) return;
    root.textContent = '';
    for (const group of groups) {
      if (!group.info) continue;
      // Group label only when the page belongs to more than one database.
      if (groups.length > 1) {
        root.appendChild(el('div', 'canvas-db-rowprops__group', group.info.title));
      }
      for (const prop of group.props) {
        const row = el('div', 'canvas-db-rowprops__row');
        const name = el('div', 'canvas-db-rowprops__name');
        name.appendChild(createTypeIconElement(prop.type, 14));
        name.appendChild(el('span', '', prop.name));
        row.appendChild(name);

        const valueEl = el('div', 'canvas-db-rowprops__value');
        const value = group.values[prop.id];
        if (prop.type === 'checkbox') {
          const box = el('div', `canvas-db-check${value ? ' canvas-db-check--on' : ''}`);
          box.addEventListener('click', (e) => {
            e.stopPropagation();
            void db.setCellValue(group.databaseId, pageId, prop.id, !value);
          });
          valueEl.appendChild(box);
        } else if ((prop.type === 'select' || prop.type === 'tags') && value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
          // Pills are clickable → "pages tagged X" popover (M85 parity).
          const vals = Array.isArray(value) ? value.map(String) : [String(value)];
          for (const v of vals) {
            const pill = pillEl(v, optionColor(prop, v));
            pill.classList.add('canvas-db-rowprops__pill');
            pill.addEventListener('click', (e) => {
              e.stopPropagation();
              void showPagesForValue(group.databaseId, prop, v, pill);
            });
            valueEl.appendChild(pill);
          }
          // A small edit affordance next to the pills.
          const edit = el('button', 'canvas-db-rowprops__edit', '✎');
          edit.title = 'Edit';
          edit.addEventListener('click', () => {
            valueEl.textContent = '';
            const editor = createPropertyEditor(asDefinition(prop), value ?? null, (next) => {
              void db.setCellValue(group.databaseId, pageId, prop.id, next);
            });
            valueEl.appendChild(editor);
          });
          valueEl.appendChild(edit);
        } else {
          if (value !== null && value !== undefined && value !== '') {
            valueEl.textContent = Array.isArray(value) ? value.join(', ') : String(value);
          } else {
            valueEl.appendChild(el('span', 'canvas-db-rowprops__empty', 'Empty'));
          }
          valueEl.addEventListener('click', () => {
            valueEl.textContent = '';
            const editor = createPropertyEditor(asDefinition(prop), value ?? null, (next) => {
              void db.setCellValue(group.databaseId, pageId, prop.id, next);
            });
            valueEl.appendChild(editor);
            (editor.querySelector('input') as HTMLElement | null)?.focus();
          }, { once: true });
        }
        row.appendChild(valueEl);
        root.appendChild(row);
      }
    }
  };

  const onChange = (): void => {
    void (async () => {
      const next = await db.listDatabasesForPage(pageId);
      if (disposed) return;
      databaseIds = next;
      if (databaseIds.length === 0) { root.remove(); return; }
      mountRoot();
      await render();
    })();
  };
  disposables.add(db.onDidChangeRows(onChange));
  disposables.add(db.onDidChangeStructure(onChange));
  if (databaseIds.length > 0) await render();

  return {
    dispose: () => {
      disposed = true;
      disposables.dispose();
      root.remove();
    },
  };
}
