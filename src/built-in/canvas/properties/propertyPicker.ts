// propertyPicker.ts — "+ Add property" dropdown for the canvas property bar
//
// Shows workspace property definitions not already on the current page,
// with search/filter and a "Create new property" option at the bottom.

import type { IPropertyDefinition, PropertyType } from './propertyTypes.js';
import { createTypeIconElement, getTypeIcon } from './propertyEditors.js';
import { layoutPopup } from '../../../ui/dom.js';

const ALL_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'tags', label: 'Tags' },
  { value: 'select', label: 'Select' },
  { value: 'url', label: 'URL' },
];

/**
 * Show the property picker dropdown anchored to a button.
 */
export function showPropertyPicker(
  anchor: HTMLElement,
  existingKeys: string[],
  definitions: IPropertyDefinition[],
  onAdd: (name: string) => void,
  onCreateNew: (name: string, type: PropertyType) => void,
): void {
  // Dismiss any existing picker
  const existing = document.querySelector('.canvas-property-picker');
  if (existing) { existing.remove(); }

  const available = definitions.filter(d => !existingKeys.includes(d.name));

  const picker = document.createElement('div');
  picker.className = 'canvas-property-picker';

  // ── Search input ──
  const searchWrap = document.createElement('div');
  searchWrap.className = 'canvas-property-picker__search';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search properties...';
  searchWrap.appendChild(searchInput);
  picker.appendChild(searchWrap);

  // ── List ──
  const list = document.createElement('div');
  list.className = 'canvas-property-picker__list';
  picker.appendChild(list);

  // ── Create-new section (shown when user clicks "Create new") ──
  let newForm: HTMLElement | null = null;

  const renderList = (filter: string) => {
    list.innerHTML = '';
    const lowerFilter = filter.toLowerCase();
    const filtered = available.filter(d =>
      !lowerFilter || d.name.toLowerCase().includes(lowerFilter),
    );

    for (const def of filtered) {
      const item = document.createElement('div');
      item.className = 'canvas-property-picker__item';

      const icon = createTypeIconElement(def.type, 14);
      icon.classList.add('canvas-property-picker__item-icon');
      item.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = def.name;
      item.appendChild(label);

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dismiss();
        onAdd(def.name);
      });

      list.appendChild(item);
    }

    // Divider + "Create new" option
    if (filtered.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'canvas-property-picker__divider';
      list.appendChild(divider);
    }

    const createBtn = document.createElement('div');
    createBtn.className = 'canvas-property-picker__create';
    createBtn.textContent = '+ Create new property';
    createBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _showNewForm();
    });
    list.appendChild(createBtn);
  };

  const _showNewForm = () => {
    if (newForm) return;

    newForm = document.createElement('div');
    newForm.className = 'canvas-property-picker__new-form';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Property name';
    newForm.appendChild(nameInput);

    const typeSelect = document.createElement('select');
    for (const t of ALL_TYPES) {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = `${getTypeIcon(t.value)} ${t.label}`;
      typeSelect.appendChild(opt);
    }
    newForm.appendChild(typeSelect);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Create';
    submitBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const type = typeSelect.value as PropertyType;
      dismiss();
      onCreateNew(name, type);
    });
    newForm.appendChild(submitBtn);

    picker.appendChild(newForm);

    // Focus the name input
    requestAnimationFrame(() => nameInput.focus());
  };

  searchInput.addEventListener('input', () => {
    renderList(searchInput.value.trim());
  });

  renderList('');

  // Mount and position
  document.body.appendChild(picker);
  layoutPopup(picker, anchor.getBoundingClientRect(), { position: 'below', gap: 4 });

  // Focus search
  requestAnimationFrame(() => searchInput.focus());

  // Outside click dismissal
  const outsideClick = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      dismiss();
    }
  };
  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };

  setTimeout(() => {
    document.addEventListener('mousedown', outsideClick);
    document.addEventListener('keydown', escapeHandler);
  }, 0);

  function dismiss() {
    picker.remove();
    document.removeEventListener('mousedown', outsideClick);
    document.removeEventListener('keydown', escapeHandler);
  }
}
