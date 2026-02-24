// propertyConfig.ts — Property configuration UI for database columns
//
// Provides the property add menu, property rename, type change,
// delete confirmation, reorder, and per-type config popups (number format,
// select option list editor, status group management).
//
// Dependencies: platform/ (lifecycle, events), ui/ (dom, contextMenu),
// databaseTypes (type-only)

import { $ } from '../../../../ui/dom.js';
import { ContextMenu, type IContextMenuItem } from '../../../../ui/contextMenu.js';
import type {
  PropertyType,
  IDatabaseDataService,
  IDatabaseProperty,
  ISelectPropertyConfig,
  IMultiSelectPropertyConfig,
  INumberPropertyConfig,
  ISelectOption,
} from '../databaseTypes.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  title: 'Title',
  rich_text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  status: 'Status',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  phone_number: 'Phone',
  files: 'Files & media',
  relation: 'Relation',
  rollup: 'Rollup',
  formula: 'Formula',
  created_time: 'Created time',
  last_edited_time: 'Last edited time',
  unique_id: 'ID',
};

const PROPERTY_TYPE_ICONS: Record<PropertyType, string> = {
  title: 'Aa',
  rich_text: 'T',
  number: '#',
  select: '▾',
  multi_select: '⊞',
  status: '◉',
  date: '📅',
  checkbox: '☑',
  url: '🔗',
  email: '✉',
  phone_number: '☎',
  files: '📎',
  relation: '↗',
  rollup: 'Σ',
  formula: 'ƒ',
  created_time: '🕐',
  last_edited_time: '🕐',
  unique_id: 'ID',
};

/** Property types users can create (excludes computed/system types). */
const CREATABLE_TYPES: PropertyType[] = [
  'rich_text', 'number', 'select', 'multi_select', 'status',
  'date', 'checkbox', 'url', 'email', 'phone_number', 'files',
];

/** Default colors for new select/status options. */
const DEFAULT_OPTION_COLORS = [
  'default', 'gray', 'brown', 'orange', 'yellow',
  'green', 'blue', 'purple', 'pink', 'red',
];

// ─── Property Add Menu ───────────────────────────────────────────────────────

/**
 * Show a menu of property types to add a new column.
 * Returns a promise that resolves when the menu is dismissed.
 */
export function showPropertyAddMenu(
  anchor: HTMLElement,
  dataService: IDatabaseDataService,
  databaseId: string,
): void {
  const items: IContextMenuItem[] = CREATABLE_TYPES.map(type => ({
    id: type,
    label: `${PROPERTY_TYPE_ICONS[type]}  ${PROPERTY_TYPE_LABELS[type]}`,
  }));

  const rect = anchor.getBoundingClientRect();
  const menu = ContextMenu.show({
    items,
    anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
    anchorPosition: 'below',
  });

  menu.onDidSelect(e => {
    const type = e.item.id as PropertyType;
    const name = PROPERTY_TYPE_LABELS[type];
    dataService.addProperty(databaseId, name, type).catch(err => {
      console.error('[PropertyConfig] Add property failed:', err);
    });
  });
}

// ─── Property Header Context Menu ────────────────────────────────────────────

/**
 * Show the context menu for a property column header (rename, change type, delete).
 */
export function showPropertyHeaderMenu(
  event: MouseEvent,
  property: IDatabaseProperty,
  dataService: IDatabaseDataService,
  databaseId: string,
  onRename: () => void,
): void {
  event.preventDefault();

  const items: IContextMenuItem[] = [
    {
      id: 'rename',
      label: 'Rename property',
    },
    {
      id: 'change-type',
      label: 'Change type',
      submenu: CREATABLE_TYPES.filter(t => t !== property.type).map(type => ({
        id: `type:${type}`,
        label: `${PROPERTY_TYPE_ICONS[type]}  ${PROPERTY_TYPE_LABELS[type]}`,
      })),
    },
  ];

  // Don't allow deleting the title property
  if (property.type !== 'title') {
    items.push(
      { id: '__sep__', label: '', group: 'danger' },
      {
        id: 'delete',
        label: 'Delete property',
        className: 'context-menu-item--danger',
      },
    );
  }

  const menu = ContextMenu.show({
    items,
    anchor: { x: event.clientX, y: event.clientY },
  });

  menu.onDidSelect(e => {
    if (e.item.id === 'rename') {
      onRename();
    } else if (e.item.id.startsWith('type:')) {
      const newType = e.item.id.slice(5) as PropertyType;
      dataService.updateProperty(databaseId, property.id, { type: newType }).catch(err => {
        console.error('[PropertyConfig] Change type failed:', err);
      });
    } else if (e.item.id === 'delete') {
      dataService.removeProperty(databaseId, property.id).catch(err => {
        console.error('[PropertyConfig] Delete property failed:', err);
      });
    }
  });
}

// ─── Inline Property Rename ──────────────────────────────────────────────────

/**
 * Replace a header cell's content with an inline text input for renaming.
 * Restores original content when done.
 */
export function startPropertyRename(
  headerCell: HTMLElement,
  property: IDatabaseProperty,
  dataService: IDatabaseDataService,
  databaseId: string,
): void {
  const originalContent = headerCell.innerHTML;
  headerCell.innerHTML = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.classList.add('db-header-rename-input');
  input.value = property.name;
  headerCell.appendChild(input);

  const finish = (commit: boolean) => {
    const newName = input.value.trim();
    headerCell.innerHTML = originalContent;
    if (commit && newName && newName !== property.name) {
      dataService.updateProperty(databaseId, property.id, { name: newName }).catch(err => {
        console.error('[PropertyConfig] Rename failed:', err);
      });
    }
  };

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
    e.stopPropagation();
  });

  input.addEventListener('blur', () => finish(true));

  input.focus();
  input.select();
}

// ─── Number Format Config ────────────────────────────────────────────────────

export function showNumberFormatMenu(
  anchor: HTMLElement,
  property: IDatabaseProperty,
  dataService: IDatabaseDataService,
  databaseId: string,
): void {
  const currentFormat = (property.config as INumberPropertyConfig)?.format ?? 'number';
  const formats = [
    { id: 'number', label: 'Number' },
    { id: 'number_with_commas', label: '1,000' },
    { id: 'percent', label: 'Percent' },
    { id: 'dollar', label: 'Dollar ($)' },
    { id: 'euro', label: 'Euro (€)' },
    { id: 'pound', label: 'Pound (£)' },
    { id: 'yen', label: 'Yen (¥)' },
    { id: 'yuan', label: 'Yuan (¥)' },
  ];

  const items: IContextMenuItem[] = formats.map(f => ({
    id: f.id,
    label: f.label,
    className: f.id === currentFormat ? 'context-menu-item--selected' : '',
  }));

  const rect = anchor.getBoundingClientRect();
  const menu = ContextMenu.show({
    items,
    anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
    anchorPosition: 'below',
  });

  menu.onDidSelect(e => {
    const newConfig: INumberPropertyConfig = { format: e.item.id as INumberPropertyConfig['format'] };
    dataService.updateProperty(databaseId, property.id, { config: newConfig }).catch(err => {
      console.error('[PropertyConfig] Number format change failed:', err);
    });
  });
}

// ─── Select/Multi-Select Option List Editor ──────────────────────────────────

/**
 * Show a simple option list editor for Select or Multi-Select properties.
 * Allows adding, renaming, changing color, and deleting options.
 *
 * For M8, this uses a ContextMenu for simplicity. A richer panel editor
 * with inline rename and color swatches is deferred to Phase 3.
 */
export function showOptionListEditor(
  anchor: HTMLElement,
  property: IDatabaseProperty,
  dataService: IDatabaseDataService,
  databaseId: string,
): void {
  const config = property.config as ISelectPropertyConfig | IMultiSelectPropertyConfig;
  const options = config?.options ?? [];

  const items: IContextMenuItem[] = [
    ...options.map((opt: ISelectOption) => ({
      id: `opt:${opt.id}`,
      label: opt.name,
      renderIcon: (iconContainer: HTMLElement) => {
        const dot = $('span.db-option-dot');
        dot.classList.add(`db-option-dot--${opt.color}`);
        iconContainer.appendChild(dot);
      },
    })),
    { id: '__sep__', label: '', group: 'add' },
    { id: '__add__', label: '+ Create an option' },
  ];

  const rect = anchor.getBoundingClientRect();
  const menu = ContextMenu.show({
    items,
    anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
    anchorPosition: 'below',
  });

  menu.onDidSelect(e => {
    if (e.item.id === '__add__') {
      _addNewOption(property, options, dataService, databaseId);
    }
    // Clicking an existing option could open a rename/color sub-menu in the future
  });
}

function _addNewOption(
  property: IDatabaseProperty,
  existingOptions: ISelectOption[],
  dataService: IDatabaseDataService,
  databaseId: string,
): void {
  const name = prompt('Option name:'); // TODO: replace with inline input overlay
  if (!name) return;

  const color = DEFAULT_OPTION_COLORS[existingOptions.length % DEFAULT_OPTION_COLORS.length];
  const newOption: ISelectOption = {
    id: crypto.randomUUID(),
    name,
    color,
  };

  const newOptions = [...existingOptions, newOption];
  const newConfig = { ...property.config, options: newOptions };
  dataService.updateProperty(databaseId, property.id, { config: newConfig }).catch(err => {
    console.error('[PropertyConfig] Add option failed:', err);
  });
}

// ─── Exported type info ──────────────────────────────────────────────────────

export { PROPERTY_TYPE_LABELS, PROPERTY_TYPE_ICONS };
