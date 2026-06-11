// rowPropertiesSection.ts — the PROPERTY PANEL shown on EVERY canvas page
// (the same UI the pre-database PropertyBar had — same DOM classes, same
// stylesheet). Only the BACKEND changed: properties live in DATABASES, shared
// by member pages. The plumbing is invisible:
//
//   - the Tags row is ALWAYS present — tagging a page lazily creates the
//     workspace 'Tags' database and joins the page to it;
//   - membership databases contribute their property rows (grouped + labeled
//     when a page is in more than one);
//   - created / modified render read-only from the page row itself;
//   - '+ Add property' works on any page — it adds a COLUMN to the page's
//     database, or to the lazily-created 'Page properties' workspace database
//     (joining the page) when it has none.

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
const TAGS_DB_TITLE = 'Tags';
const BUCKET_DB_TITLE = 'Page properties';

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}
function writeCollapsed(value: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, String(value)); } catch { /* non-fatal */ }
}

function asDefinition(prop: IDatabaseProperty): IPropertyDefinition {
  return { name: prop.name, type: prop.type, config: prop.config, sortOrder: prop.sortOrder, createdAt: '', updatedAt: '' };
}

function formatTimestamp(iso: string | undefined | null): string {
  if (!iso) return 'Empty';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface IMembershipGroup {
  readonly databaseId: string;
  readonly title: string;
  readonly props: IDatabaseProperty[];
  readonly values: Record<string, unknown>;
}

/**
 * Mount the property panel for `pageId` into `host` (before `beforeEl` —
 * Notion order: title, properties, content). Always mounts; membership rows
 * stay live as the page joins/leaves databases.
 */
export async function mountRowPropertiesSection(
  host: HTMLElement,
  pageId: string,
  db: DatabaseDataService,
  beforeEl?: HTMLElement | null,
  /** Open a member page from the "pages with X" popover. */
  openPage?: (pageId: string) => void,
  /** Page timestamps for the read-only created/modified rows. */
  getPageMeta?: () => Promise<{ createdAt: string; updatedAt: string } | null>,
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

  // The panel is on EVERY page (the old bar's behavior).
  if (beforeEl && beforeEl.parentElement) beforeEl.parentElement.insertBefore(root, beforeEl);
  else host.prepend(root);

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

  // ── Row builders ──
  const buildRowShell = (key: string, type: string, labelText: string): { row: HTMLElement; value: HTMLElement } => {
    const row = document.createElement('div');
    row.className = 'canvas-property-row';
    row.dataset.propertyKey = key;
    const name = document.createElement('div');
    name.className = 'canvas-property-row__name';
    const typeIcon = createTypeIconElement(type, 16);
    typeIcon.classList.add('canvas-property-row__type-icon');
    name.appendChild(typeIcon);
    const label = document.createElement('span');
    label.className = 'canvas-property-row__label';
    label.textContent = labelText;
    name.appendChild(label);
    row.appendChild(name);
    const value = document.createElement('div');
    value.className = 'canvas-property-row__value';
    row.appendChild(value);
    return { row, value };
  };

  const createMembershipRow = (group: IMembershipGroup, prop: IDatabaseProperty): HTMLElement => {
    const { row, value } = buildRowShell(prop.name, prop.type, prop.name);
    const editor = createPropertyEditor(asDefinition(prop), group.values[prop.id] ?? null, (newValue) => {
      db.setCellValue(group.databaseId, pageId, prop.id, newValue).catch((err) => {
        console.error(`[PropertyPanel] Failed to save property "${prop.name}":`, err);
      });
    }, {
      onValueClick: (propertyName, tagValue, anchor) => void showPagesForValue(group, propertyName, tagValue, anchor),
    });
    value.appendChild(editor);

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

  /** The always-present Tags row for a page NOT yet in the Tags database:
   *  first tag lazily creates/joins the workspace Tags database. */
  const createSyntheticTagsRow = (): HTMLElement => {
    const { row, value } = buildRowShell('tags', 'tags', 'Tags');
    const definition: IPropertyDefinition = { name: 'Tags', type: 'tags', config: { options: [] }, sortOrder: 0, createdAt: '', updatedAt: '' };
    const editor = createPropertyEditor(definition, [], (newValue) => {
      void (async () => {
        try {
          const { databaseId, propertyId } = await db.ensureWorkspaceDatabase(TAGS_DB_TITLE, { name: 'Tags', type: 'tags', config: { options: [] } });
          await db.addExistingPageAsRow(databaseId, pageId);
          await db.setCellValue(databaseId, pageId, propertyId!, newValue);
          // Events re-render the panel; the row becomes a real membership row.
        } catch (err) {
          console.error('[PropertyPanel] Failed to tag page:', err);
        }
      })();
    });
    value.appendChild(editor);
    return row;
  };

  /** Read-only created/modified rows (from the page row — no DB writes). */
  const createTimestampRow = (key: 'created' | 'modified', iso: string | undefined): HTMLElement => {
    const { row, value } = buildRowShell(key, 'datetime', key);
    const display = document.createElement('span');
    display.className = 'canvas-prop-date-trigger';
    display.style.pointerEvents = 'none';
    display.textContent = formatTimestamp(iso);
    value.appendChild(display);
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

    const [groups, meta] = await Promise.all([
      Promise.all(databaseIds.map(async (databaseId) => ({
        databaseId,
        title: (await db.getDatabase(databaseId))?.title ?? 'Database',
        props: await db.listProperties(databaseId),
        values: await db.getRowValues(databaseId, pageId),
      }))),
      getPageMeta?.() ?? Promise.resolve(null),
    ]);
    if (disposed) { rendering = false; return; }

    body.textContent = '';

    // Membership rows, grouped + labeled when in more than one database.
    for (const group of groups) {
      if (groups.length > 1) {
        const groupLabel = document.createElement('div');
        groupLabel.className = 'canvas-db-rowprops__group';
        groupLabel.textContent = group.title;
        body.appendChild(groupLabel);
      }
      for (const prop of group.props) {
        body.appendChild(createMembershipRow(group, prop));
      }
    }

    // The Tags row is ALWAYS present — synthetic when the page isn't a Tags
    // member yet (first tag joins it).
    const hasTagsRow = groups.some((g) => g.props.some((p) => p.type === 'tags' && p.name.toLowerCase() === 'tags'));
    if (!hasTagsRow) body.appendChild(createSyntheticTagsRow());

    // created / modified — read-only, from the page itself.
    if (meta) {
      body.appendChild(createTimestampRow('created', meta.createdAt));
      body.appendChild(createTimestampRow('modified', meta.updatedAt));
    }

    // '+ Add property' — adds a COLUMN to the page's database; pages in no
    // database get the lazily-created 'Page properties' workspace database.
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
      // Prefer a non-Tags membership (real schema); else Tags; else the bucket.
      const target = groups.find((g) => g.title !== TAGS_DB_TITLE) ?? groups[0];
      const existing = target ? target.props.map((p) => p.name) : [];
      showPropertyPicker(
        addBtn,
        existing,
        target ? target.props.map(asDefinition) : [],
        () => { /* every database property already applies to every member page */ },
        (propName: string, type: PropertyType) => {
          void (async () => {
            try {
              const config = type === 'select' || type === 'tags' ? { options: [] } : {};
              if (target) {
                await db.addProperty(target.databaseId, propName, type, config);
              } else {
                const { databaseId } = await db.ensureWorkspaceDatabase(BUCKET_DB_TITLE);
                await db.addExistingPageAsRow(databaseId, pageId);
                await db.addProperty(databaseId, propName, type, config);
              }
            } catch (err) {
              console.error(`[PropertyPanel] Failed to add property "${propName}":`, err);
            }
          })();
        },
      );
    });
    body.appendChild(addBtn);

    rendering = false;
    if (renderQueued) { renderQueued = false; void render(); }
  };

  // ── Live membership + data reactivity ──
  const onChange = (): void => {
    void (async () => {
      const next = await db.listDatabasesForPage(pageId);
      if (disposed) return;
      databaseIds = next;
      await render();
    })();
  };
  disposables.add(db.onDidChangeRows(onChange));
  disposables.add(db.onDidChangeStructure(onChange));
  await render();

  return {
    dispose: () => {
      disposed = true;
      disposables.dispose();
      root.remove();
    },
  };
}
