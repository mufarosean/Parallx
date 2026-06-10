// rowPropertiesSection.ts — the PROPERTY PANEL at the top of a page that
// belongs to a database (Notion anatomy, verified against the help center):
// directly under the title, each property is a ROW — type icon + gray name on
// the left, click-to-edit value on the right, "Empty" placeholder — with a
// "+ Add property" button at the bottom, then the page body.
//
// This is the SAME UI the pre-database PropertyBar had (same DOM classes, same
// stylesheet — propertyBar.css) — only the BACKEND moved: properties belong to
// the page's DATABASE(S) (database_properties + page_property_values), shared
// by all member pages, instead of the retired per-page tables.
//
// Memberships are LIVE: a page can gain membership while open (the legacy
// migration, canvas_add_page_to_database) and the panel (un)mounts itself.
// Multi-membership (a Parallx extension — Notion pages live in one database)
// renders one labeled group per database.

import '../properties/propertyBar.css';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { DisposableStore } from '../../../platform/lifecycle.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import { applyFilter } from './databaseViewModel.js';
import { createPropertyEditor, createTypeIconElement } from '../properties/propertyEditors.js';
import { createIconElement } from '../../../ui/iconRegistry.js';
import type { IPropertyDefinition, PropertyType } from '../properties/propertyTypes.js';
import { showPropertyPicker } from '../properties/propertyPicker.js';

const COLLAPSED_KEY = 'canvas.propertyBar.collapsed';

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}
function writeCollapsed(value: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, String(value)); } catch { /* non-fatal */ }
}

function asDefinition(prop: IDatabaseProperty): IPropertyDefinition {
  return { name: prop.name, type: prop.type, config: prop.config, sortOrder: prop.sortOrder, createdAt: '', updatedAt: '' };
}

interface IMembershipGroup {
  readonly databaseId: string;
  readonly title: string;
  readonly props: IDatabaseProperty[];
  readonly values: Record<string, unknown>;
}

/**
 * Mount the database property panel for `pageId` into `host` (before
 * `beforeEl` — Notion order: title, properties, content). Mounts/unmounts
 * itself live as the page's database memberships change; standalone pages
 * (no membership) show nothing, exactly like Notion.
 */
export async function mountRowPropertiesSection(
  host: HTMLElement,
  pageId: string,
  db: DatabaseDataService,
  beforeEl?: HTMLElement | null,
  /** Open a member page from the "pages with X" popover. */
  openPage?: (pageId: string) => void,
): Promise<IDisposable | null> {
  let databaseIds = await db.listDatabasesForPage(pageId);

  const disposables = new DisposableStore();
  let disposed = false;

  // ── Shell: the SAME structure/classes the PropertyBar used ──
  const root = document.createElement('div');
  root.className = 'canvas-property-bar';
  if (readCollapsed()) root.classList.add('collapsed');

  const header = document.createElement('div');
  header.className = 'canvas-property-bar__header';
  const headerLabel = document.createElement('span');
  headerLabel.textContent = 'Properties';
  header.appendChild(headerLabel);
  header.addEventListener('click', () => {
    root.classList.toggle('collapsed');
    writeCollapsed(root.classList.contains('collapsed'));
  });
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'canvas-property-bar__body';
  root.appendChild(body);

  const mountRoot = (): void => {
    if (root.isConnected) return;
    if (beforeEl && beforeEl.parentElement) beforeEl.parentElement.insertBefore(root, beforeEl);
    else host.prepend(root);
  };
  if (databaseIds.length > 0) mountRoot();

  // ── "Pages with value X" popover (M85 parity over database rows) ──
  let activePopover: HTMLElement | null = null;
  const closePopover = (): void => { activePopover?.remove(); activePopover = null; };
  disposables.add({ dispose: closePopover });

  const showPagesForValue = async (group: IMembershipGroup, propertyName: string, value: string, anchor: HTMLElement): Promise<void> => {
    closePopover();
    const prop = group.props.find((p) => p.name === propertyName);
    if (!prop) return;
    const rows = applyFilter(await db.listRows(group.databaseId), {
      conjunction: 'and',
      rules: [{ propertyId: prop.id, op: 'contains', value }],
    }).filter((r) => r.pageId !== pageId);

    const pop = document.createElement('div');
    pop.className = 'canvas-prop-value-popover';
    const popHeader = document.createElement('div');
    popHeader.className = 'canvas-prop-value-popover__header';
    popHeader.textContent = rows.length === 0 ? `No other pages with "${value}"` : `Pages with "${value}"`;
    pop.appendChild(popHeader);
    for (const r of rows.slice(0, 20)) {
      const item = document.createElement('button');
      item.className = 'canvas-prop-value-popover__item';
      item.textContent = r.title || 'Untitled';
      item.addEventListener('click', () => { closePopover(); openPage?.(r.pageId); });
      pop.appendChild(item);
    }
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
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

  // ── Rows ──
  const createPropertyRow = (group: IMembershipGroup, prop: IDatabaseProperty): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'canvas-property-row';
    row.dataset.propertyKey = prop.name;

    const name = document.createElement('div');
    name.className = 'canvas-property-row__name';
    const typeIcon = createTypeIconElement(prop.type, 16);
    typeIcon.classList.add('canvas-property-row__type-icon');
    name.appendChild(typeIcon);
    const label = document.createElement('span');
    label.className = 'canvas-property-row__label';
    label.textContent = prop.name;
    name.appendChild(label);
    row.appendChild(name);

    const value = document.createElement('div');
    value.className = 'canvas-property-row__value';
    const editor = createPropertyEditor(asDefinition(prop), group.values[prop.id] ?? null, (newValue) => {
      db.setCellValue(group.databaseId, pageId, prop.id, newValue).catch((err) => {
        console.error(`[PropertyPanel] Failed to save property "${prop.name}":`, err);
      });
    }, {
      onValueClick: (propertyName, tagValue, anchor) => void showPagesForValue(group, propertyName, tagValue, anchor),
    });
    value.appendChild(editor);
    row.appendChild(value);

    // × — clear this page's value (the database column itself stays).
    const clearBtn = document.createElement('button');
    clearBtn.className = 'canvas-property-row__delete';
    clearBtn.textContent = '×';
    clearBtn.title = `Clear ${prop.name} on this page`;
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      db.setCellValue(group.databaseId, pageId, prop.id, null).catch((err) => {
        console.error(`[PropertyPanel] Failed to clear property "${prop.name}":`, err);
      });
    });
    row.appendChild(clearBtn);

    // 🗑 — delete the property (column) from the database, everywhere.
    const deleteDefinitionBtn = document.createElement('button');
    deleteDefinitionBtn.className = 'canvas-property-row__delete-definition';
    deleteDefinitionBtn.title = `Delete property "${prop.name}" from "${group.title}" everywhere`;
    deleteDefinitionBtn.appendChild(createIconElement('trash', 14));
    deleteDefinitionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.confirm(`Delete property "${prop.name}" from the "${group.title}" database and all its pages?`)) {
        void db.deleteProperty(group.databaseId, prop.id);
      }
    });
    row.appendChild(deleteDefinitionBtn);

    return row;
  };

  // ── Render ──
  let rendering = false;
  let renderQueued = false;
  const render = async (): Promise<void> => {
    if (disposed) return;
    if (rendering) { renderQueued = true; return; }
    rendering = true;
    renderQueued = false;

    const groups: IMembershipGroup[] = await Promise.all(databaseIds.map(async (databaseId) => ({
      databaseId,
      title: (await db.getDatabase(databaseId))?.title ?? 'Database',
      props: await db.listProperties(databaseId),
      values: await db.getRowValues(databaseId, pageId),
    })));
    if (disposed) { rendering = false; return; }

    body.textContent = '';
    for (const group of groups) {
      // Group label only when the page belongs to MORE than one database
      // (multi-membership is a Parallx extension; Notion pages live in one).
      if (groups.length > 1) {
        const groupLabel = document.createElement('div');
        groupLabel.className = 'canvas-db-rowprops__group';
        groupLabel.textContent = group.title;
        body.appendChild(groupLabel);
      }
      for (const prop of group.props) {
        body.appendChild(createPropertyRow(group, prop));
      }
    }

    // "+ Add property" — adds a COLUMN to the page's database (first
    // membership when several): every member page shares it.
    const target = groups[0];
    if (target) {
      const addBtn = document.createElement('button');
      addBtn.className = 'canvas-property-add';
      const addIcon = document.createElement('span');
      addIcon.className = 'canvas-property-add__icon';
      addIcon.textContent = '+';
      addBtn.appendChild(addIcon);
      const addLabel = document.createElement('span');
      addLabel.textContent = 'Add property';
      addBtn.appendChild(addLabel);
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = target.props.map((p) => p.name);
        showPropertyPicker(
          addBtn,
          existing,
          target.props.map(asDefinition),
          () => { /* every database property already applies to every member page */ },
          (propName: string, type: PropertyType) => {
            const config = type === 'select' || type === 'tags' ? { options: [] } : {};
            void db.addProperty(target.databaseId, propName, type, config);
          },
        );
      });
      body.appendChild(addBtn);
    }

    rendering = false;
    if (renderQueued) { renderQueued = false; void render(); }
  };

  // ── Live membership + data reactivity ──
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
