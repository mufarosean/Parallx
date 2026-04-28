// propertyPicker.ts — "+ Add property" dropdown for the canvas property bar
//
// Shows workspace property definitions not already on the current page,
// with search/filter and a "Create new property" option at the bottom.

import type { IPropertyDefinition, PropertyType } from './propertyTypes.js';
import { createTypeIconElement } from './propertyEditors.js';
import { layoutPopup, attachPopupDismiss } from '../../../ui/dom.js';

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

    // Custom type picker (replaces native <select> so icons render)
    let selectedType: PropertyType = 'text';

    const typeBtn = document.createElement('button');
    typeBtn.type = 'button';
    typeBtn.className = 'canvas-property-picker__type-btn';
    const _updateTypeBtn = () => {
      typeBtn.innerHTML = '';
      const icon = createTypeIconElement(selectedType, 14);
      typeBtn.appendChild(icon);
      const lbl = document.createElement('span');
      lbl.textContent = ALL_TYPES.find(t => t.value === selectedType)?.label ?? selectedType;
      typeBtn.appendChild(lbl);
      const chevron = document.createElement('span');
      chevron.className = 'canvas-property-picker__type-chevron';
      chevron.textContent = '▾';
      typeBtn.appendChild(chevron);
    };
    _updateTypeBtn();

    typeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showTypeDropdown(typeBtn);
    });
    newForm.appendChild(typeBtn);

    // Type dropdown
    let typeDropdown: HTMLElement | null = null;
    const _showTypeDropdown = (anchor: HTMLElement) => {
      if (typeDropdown) { typeDropdown.remove(); typeDropdown = null; return; }
      typeDropdown = document.createElement('div');
      typeDropdown.className = 'canvas-property-picker__type-dropdown';

      for (const t of ALL_TYPES) {
        const item = document.createElement('div');
        item.className = 'canvas-property-picker__type-item';
        if (t.value === selectedType) item.classList.add('canvas-property-picker__type-item--active');

        const ic = createTypeIconElement(t.value, 14);
        item.appendChild(ic);
        const span = document.createElement('span');
        span.textContent = t.label;
        item.appendChild(span);

        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          selectedType = t.value;
          _updateTypeBtn();
          typeDropdown?.remove();
          typeDropdown = null;
        });
        typeDropdown.appendChild(item);
      }

      // Position below the type button
      anchor.parentElement!.appendChild(typeDropdown);
      const btnRect = anchor.getBoundingClientRect();
      const formRect = anchor.parentElement!.getBoundingClientRect();
      typeDropdown.style.top = `${btnRect.bottom - formRect.top}px`;
      typeDropdown.style.left = '0';
      typeDropdown.style.width = `${btnRect.width}px`;
    };

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Create';
    submitBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) return;
      dismiss();
      onCreateNew(name, selectedType);
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

  let detach: (() => void) | null = null;

  function dismiss() {
    picker.remove();
    detach?.();
    detach = null;
  }

  detach = attachPopupDismiss([picker, anchor], dismiss);
}
