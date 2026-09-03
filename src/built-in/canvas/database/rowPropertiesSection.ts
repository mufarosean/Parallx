// rowPropertiesSection.ts — the PROPERTY PANEL shown on EVERY canvas page
// (the same UI the pre-database PropertyBar had — same DOM classes, same
// stylesheet). Only the BACKEND changed: properties live in the page's HOME
// DATABASE, shared by all its member pages. SINGLE-HOME INVARIANT: a page
// belongs to at most one database; the panel IS that database's schema viewed
// from one row. The plumbing stays invisible:
//
//   - the Tags row is ALWAYS present — on a homeless page the first tag
//     lazily creates the workspace 'Tags' database and makes it the page's
//     home; on a page whose home lacks tags, it adds a Tags COLUMN to the
//     home (what a Notion user would do);
//   - created / modified render read-only from the page row itself;
//   - '+ Add property' adds a COLUMN to the page's home — or to the lazily
//     created 'Page properties' database (which becomes the home) when the
//     page has none.

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
import { showConfirmModal } from '../../../api/notificationService.js';
import { attachPopupDismiss } from '../../../ui/dom.js';

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

interface IHome {
  readonly databaseId: string;
  readonly title: string;
  readonly props: IDatabaseProperty[];
  readonly values: Record<string, unknown>;
}

/**
 * Mount the property panel for `pageId` into `host` (before `beforeEl` —
 * Notion order: title, properties, content). Always mounts; the home's rows
 * stay live as schema/values/membership change.
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

  const showPagesForValue = async (home: IHome, propertyName: string, value: string, anchor: HTMLElement): Promise<void> => {
    closePopover();
    const prop = home.props.find((p) => p.name === propertyName);
    if (!prop) return;
    const rows = applyFilter(await db.listRows(home.databaseId), {
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
    // Standard popup contract — the branch-local removal this replaces
    // leaked the capture listener whenever the popover closed any other
    // way (item click, re-open, section dispose).
    const detach = attachPopupDismiss(pop, closePopover);
    disposables.add({ dispose: detach });
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

  const createHomeRow = (home: IHome, prop: IDatabaseProperty): HTMLElement => {
    const { row, value } = buildRowShell(prop.name, prop.type, prop.name);
    const editor = createPropertyEditor(asDefinition(prop), home.values[prop.id] ?? null, (newValue) => {
      db.setCellValue(home.databaseId, pageId, prop.id, newValue).catch((err) => {
        console.error(`[PropertyPanel] Failed to save property "${prop.name}":`, err);
      });
    }, {
      onValueClick: (propertyName, tagValue, anchor) => void showPagesForValue(home, propertyName, tagValue, anchor),
    });
    value.appendChild(editor);

    // × — clear this page's value (the column itself stays).
    const clearBtn = document.createElement('button');
    clearBtn.className = 'canvas-property-row__delete';
    clearBtn.textContent = '×';
    clearBtn.title = `Clear ${prop.name} on this page`;
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      db.setCellValue(home.databaseId, pageId, prop.id, null).catch((err) => {
        console.error(`[PropertyPanel] Failed to clear property "${prop.name}":`, err);
      });
    });
    row.appendChild(clearBtn);

    // 🗑 — delete the property (column) from the home database, everywhere.
    const deleteDefinitionBtn = document.createElement('button');
    deleteDefinitionBtn.className = 'canvas-property-row__delete-definition';
    deleteDefinitionBtn.title = `Delete property "${prop.name}" from "${home.title}" everywhere`;
    deleteDefinitionBtn.appendChild(createIconElement('trash', 14));
    deleteDefinitionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void showConfirmModal(document.body, {
        message: `Delete the "${prop.name}" property?`,
        detail: `It is removed from the "${home.title}" database and every page that uses it.`,
        confirmLabel: 'Delete',
        danger: true,
      }).then((ok) => {
        if (ok) void db.deleteProperty(home.databaseId, prop.id);
      });
    });
    row.appendChild(deleteDefinitionBtn);

    return row;
  };

  /** The always-present Tags row when the page's schema has no tags yet:
   *  homeless page → first tag creates/joins the 'Tags' database (it becomes
   *  the home); home without tags → adds a Tags COLUMN to the home. */
  const createSyntheticTagsRow = (home: IHome | null): HTMLElement => {
    const { row, value } = buildRowShell('tags', 'tags', 'Tags');
    const definition: IPropertyDefinition = { name: 'Tags', type: 'tags', config: { options: [] }, sortOrder: 0, createdAt: '', updatedAt: '' };
    const editor = createPropertyEditor(definition, [], (newValue) => {
      void (async () => {
        try {
          if (home) {
            const prop = await db.addProperty(home.databaseId, 'Tags', 'tags', { options: [] });
            await db.setCellValue(home.databaseId, pageId, prop.id, newValue);
          } else {
            const { databaseId, propertyId } = await db.ensureWorkspaceDatabase(TAGS_DB_TITLE, { name: 'Tags', type: 'tags', config: { options: [] } });
            await db.addExistingPageAsRow(databaseId, pageId);
            await db.setCellValue(databaseId, pageId, propertyId!, newValue);
          }
          // Events re-render; the row becomes a real home row.
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
    const { row, value } = buildRowShell(key, 'datetime', key === 'created' ? 'Created' : 'Modified');
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

    const homeId = await db.getHomeDatabaseForPage(pageId);
    const [home, meta] = await Promise.all([
      (async (): Promise<IHome | null> => {
        if (!homeId) return null;
        return {
          databaseId: homeId,
          title: (await db.getDatabase(homeId))?.title ?? 'Database',
          props: await db.listProperties(homeId),
          values: await db.getRowValues(homeId, pageId),
        };
      })(),
      getPageMeta?.() ?? Promise.resolve(null),
    ]);
    if (disposed) { rendering = false; return; }

    body.textContent = '';

    // The home schema's rows — the page's row of its database, vertically.
    if (home) {
      for (const prop of home.props) body.appendChild(createHomeRow(home, prop));
    }

    // The Tags row is ALWAYS present — synthetic when the schema has none.
    const hasTagsRow = home?.props.some((p) => p.type === 'tags' && p.name.toLowerCase() === 'tags') ?? false;
    if (!hasTagsRow) body.appendChild(createSyntheticTagsRow(home));

    // created / modified — read-only, from the page itself.
    if (meta) {
      body.appendChild(createTimestampRow('created', meta.createdAt));
      body.appendChild(createTimestampRow('modified', meta.updatedAt));
    }

    // '+ Add property' — a COLUMN on the page's home; homeless pages get the
    // lazily-created 'Page properties' database as their home.
    const addBtn = document.createElement('button');
    addBtn.className = 'canvas-property-add';
    const addIcon = document.createElement('span');
    addIcon.className = 'canvas-property-add__icon';
    addIcon.textContent = '+';
    addBtn.appendChild(addIcon);
    const addLabel = document.createElement('span');
    addLabel.textContent = 'Add Property';
    addBtn.appendChild(addLabel);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = home ? home.props.map((p) => p.name) : [];
      showPropertyPicker(
        addBtn,
        existing,
        home ? home.props.map(asDefinition) : [],
        () => { /* every column of the home already applies to this page */ },
        (propName: string, type: PropertyType) => {
          void (async () => {
            try {
              const config = type === 'select' || type === 'tags' ? { options: [] } : {};
              if (home) {
                await db.addProperty(home.databaseId, propName, type, config);
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

  // ── Live home + data reactivity ──
  const onChange = (): void => { void render(); };
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
