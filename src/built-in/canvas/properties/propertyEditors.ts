// propertyEditors.ts — type-specific editor elements for the canvas property bar
//
// Factory function that creates an HTMLElement for each property type.
// Each editor calls onChange(newValue) when the user modifies the value.

import type { IPropertyDefinition, ISelectOption } from './propertyTypes.js';

// ─── Type Icon Map ───────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  text: 'T',
  number: '#',
  checkbox: '☐',
  date: '📅',
  datetime: '⏱',
  tags: '🏷',
  select: '≡',
  url: '🔗',
};

export function getTypeIcon(type: string): string {
  return TYPE_ICONS[type] ?? 'T';
}

// ─── Editor Factory ──────────────────────────────────────────────────────────

export function createPropertyEditor(
  definition: IPropertyDefinition,
  value: unknown,
  onChange: (value: unknown) => void,
): HTMLElement {
  switch (definition.type) {
    case 'text': return _createTextEditor(value as string | null, onChange);
    case 'number': return _createNumberEditor(value as number | null, onChange);
    case 'checkbox': return _createCheckboxEditor(value as boolean, onChange);
    case 'date': return _createDateEditor(value as string | null, onChange);
    case 'datetime': return _createDatetimeEditor(value as string | null, onChange);
    case 'tags': return _createTagsEditor(value as string[] | null, definition, onChange);
    case 'select': return _createSelectEditor(value as string | null, definition, onChange);
    case 'url': return _createUrlEditor(value as string | null, onChange);
    default: return _createTextEditor(value as string | null, onChange);
  }
}

// ─── Text ────────────────────────────────────────────────────────────────────

function _createTextEditor(value: string | null, onChange: (v: unknown) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'canvas-prop-input';
  input.value = value ?? '';
  input.placeholder = 'Empty';

  const commit = () => {
    const newVal = input.value.trim();
    if (newVal !== (value ?? '')) {
      onChange(newVal || null);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
  });

  return input;
}

// ─── Number ──────────────────────────────────────────────────────────────────

function _createNumberEditor(value: number | null, onChange: (v: unknown) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'canvas-prop-input';
  input.value = value != null ? String(value) : '';
  input.placeholder = 'Empty';

  const commit = () => {
    const raw = input.value.trim();
    const newVal = raw === '' ? null : Number(raw);
    if (newVal !== value) {
      onChange(newVal);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
  });

  return input;
}

// ─── Checkbox ────────────────────────────────────────────────────────────────

function _createCheckboxEditor(value: boolean, onChange: (v: unknown) => void): HTMLElement {
  const toggle = document.createElement('div');
  toggle.className = 'canvas-prop-checkbox' + (value ? ' checked' : '');

  const knob = document.createElement('div');
  knob.className = 'canvas-prop-checkbox__knob';
  toggle.appendChild(knob);

  toggle.addEventListener('click', () => {
    const newVal = !toggle.classList.contains('checked');
    toggle.classList.toggle('checked', newVal);
    onChange(newVal);
  });

  return toggle;
}

// ─── Date ────────────────────────────────────────────────────────────────────

function _createDateEditor(value: string | null, onChange: (v: unknown) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'canvas-prop-input';
  // Normalize ISO datetime to date-only
  input.value = value ? value.substring(0, 10) : '';

  input.addEventListener('change', () => {
    onChange(input.value || null);
  });

  return input;
}

// ─── Datetime ────────────────────────────────────────────────────────────────

function _createDatetimeEditor(value: string | null, onChange: (v: unknown) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.className = 'canvas-prop-input';
  // Normalize ISO to format suitable for datetime-local input
  if (value) {
    // datetime-local expects YYYY-MM-DDTHH:MM format
    input.value = value.replace(' ', 'T').substring(0, 16);
  }

  input.addEventListener('change', () => {
    onChange(input.value || null);
  });

  return input;
}

// ─── Tags ────────────────────────────────────────────────────────────────────

function _createTagsEditor(
  value: string[] | null,
  definition: IPropertyDefinition,
  onChange: (v: unknown) => void,
): HTMLElement {
  const tags: string[] = Array.isArray(value) ? [...value] : [];
  const options: ISelectOption[] = (definition.config as { options?: ISelectOption[] }).options ?? [];

  const container = document.createElement('div');
  container.className = 'canvas-prop-tags';

  let autocompleteEl: HTMLElement | null = null;
  let activeIndex = -1;

  const getTagColor = (tag: string): string => {
    const opt = options.find(o => o.value === tag);
    return opt?.color ?? 'rgba(255, 255, 255, 0.1)';
  };

  const fire = () => onChange([...tags]);

  const renderChips = () => {
    // Remove existing chips (keep the input at the end)
    const inputEl = container.querySelector('.canvas-prop-tag-input') as HTMLInputElement | null;
    container.innerHTML = '';

    for (const tag of tags) {
      const chip = document.createElement('span');
      chip.className = 'canvas-prop-tag';
      chip.style.background = getTagColor(tag);
      chip.textContent = tag;

      const remove = document.createElement('span');
      remove.className = 'canvas-prop-tag__remove';
      remove.textContent = '×';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = tags.indexOf(tag);
        if (idx >= 0) { tags.splice(idx, 1); fire(); renderChips(); }
      });
      chip.appendChild(remove);
      container.appendChild(chip);
    }

    // Re-append or create input
    if (inputEl) {
      container.appendChild(inputEl);
    } else {
      const input = document.createElement('input');
      input.className = 'canvas-prop-tag-input';
      input.placeholder = tags.length ? '' : 'Add tags...';
      _wireTagInput(input);
      container.appendChild(input);
    }
  };

  const dismissAutocomplete = () => {
    if (autocompleteEl) { autocompleteEl.remove(); autocompleteEl = null; }
    activeIndex = -1;
  };

  const showAutocomplete = (input: HTMLInputElement, filter: string) => {
    dismissAutocomplete();
    const lowerFilter = filter.toLowerCase();
    const suggestions = options
      .filter(o => !tags.includes(o.value))
      .filter(o => !lowerFilter || o.value.toLowerCase().includes(lowerFilter));

    if (suggestions.length === 0) return;

    autocompleteEl = document.createElement('div');
    autocompleteEl.className = 'canvas-prop-tag-autocomplete';
    activeIndex = -1;

    for (let i = 0; i < suggestions.length; i++) {
      const item = document.createElement('div');
      item.className = 'canvas-prop-tag-autocomplete__item';
      item.textContent = suggestions[i].value;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        tags.push(suggestions[i].value);
        input.value = '';
        fire();
        renderChips();
        dismissAutocomplete();
      });
      autocompleteEl.appendChild(item);
    }

    document.body.appendChild(autocompleteEl);
    const rect = input.getBoundingClientRect();
    autocompleteEl.style.left = `${rect.left}px`;
    autocompleteEl.style.top = `${rect.bottom + 2}px`;
  };

  const _wireTagInput = (input: HTMLInputElement) => {
    input.addEventListener('input', () => {
      showAutocomplete(input, input.value.trim());
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const raw = input.value.trim().replace(/,$/, '');
        if (raw && !tags.includes(raw)) {
          tags.push(raw);
          input.value = '';
          fire();
          renderChips();
        }
        dismissAutocomplete();
      } else if (e.key === 'Backspace' && input.value === '' && tags.length > 0) {
        tags.pop();
        fire();
        renderChips();
        dismissAutocomplete();
      } else if (e.key === 'ArrowDown' && autocompleteEl) {
        e.preventDefault();
        const items = autocompleteEl.querySelectorAll('.canvas-prop-tag-autocomplete__item');
        if (items.length > 0) {
          activeIndex = Math.min(activeIndex + 1, items.length - 1);
          items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
        }
      } else if (e.key === 'ArrowUp' && autocompleteEl) {
        e.preventDefault();
        const items = autocompleteEl.querySelectorAll('.canvas-prop-tag-autocomplete__item');
        if (items.length > 0) {
          activeIndex = Math.max(activeIndex - 1, 0);
          items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
        }
      } else if (e.key === 'Escape') {
        dismissAutocomplete();
      }
    });

    input.addEventListener('blur', () => {
      // Delay to allow click on autocomplete items
      setTimeout(() => dismissAutocomplete(), 150);
    });

    input.addEventListener('focus', () => {
      if (options.length > 0) showAutocomplete(input, '');
    });
  };

  renderChips();
  return container;
}

// ─── Select ──────────────────────────────────────────────────────────────────

function _createSelectEditor(
  value: string | null,
  definition: IPropertyDefinition,
  onChange: (v: unknown) => void,
): HTMLElement {
  const options: ISelectOption[] = (definition.config as { options?: ISelectOption[] }).options ?? [];
  let dropdownEl: HTMLElement | null = null;

  const pill = document.createElement('button');
  pill.className = 'canvas-prop-select';
  if (!value) pill.classList.add('canvas-prop-select--empty');

  const updatePill = (val: string | null) => {
    const opt = options.find(o => o.value === val);
    pill.textContent = val || 'Empty';
    pill.classList.toggle('canvas-prop-select--empty', !val);
    if (opt?.color) {
      pill.style.background = opt.color;
    } else {
      pill.style.background = '';
    }
  };
  updatePill(value);

  const dismissDropdown = () => {
    if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; }
    document.removeEventListener('mousedown', outsideClick);
  };

  const outsideClick = (e: MouseEvent) => {
    if (dropdownEl && !dropdownEl.contains(e.target as Node) && !pill.contains(e.target as Node)) {
      dismissDropdown();
    }
  };

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdownEl) { dismissDropdown(); return; }

    dropdownEl = document.createElement('div');
    dropdownEl.className = 'canvas-prop-select-dropdown';

    // "Clear" option
    const clearItem = document.createElement('div');
    clearItem.className = 'canvas-prop-select-dropdown__item';
    clearItem.style.color = 'var(--vscode-descriptionForeground, rgba(255, 255, 255, 0.4))';
    clearItem.textContent = 'Clear';
    clearItem.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      onChange(null);
      updatePill(null);
      dismissDropdown();
    });
    dropdownEl.appendChild(clearItem);

    for (const opt of options) {
      const item = document.createElement('div');
      item.className = 'canvas-prop-select-dropdown__item';

      const swatch = document.createElement('span');
      swatch.className = 'canvas-prop-select-dropdown__swatch';
      swatch.style.background = opt.color || 'rgba(255, 255, 255, 0.1)';
      item.appendChild(swatch);

      const label = document.createElement('span');
      label.textContent = opt.value;
      item.appendChild(label);

      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        onChange(opt.value);
        updatePill(opt.value);
        dismissDropdown();
      });

      dropdownEl.appendChild(item);
    }

    document.body.appendChild(dropdownEl);
    const rect = pill.getBoundingClientRect();
    dropdownEl.style.left = `${rect.left}px`;
    dropdownEl.style.top = `${rect.bottom + 2}px`;

    setTimeout(() => document.addEventListener('mousedown', outsideClick), 0);
  });

  return pill;
}

// ─── URL ─────────────────────────────────────────────────────────────────────

function _createUrlEditor(value: string | null, onChange: (v: unknown) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'canvas-prop-url-wrap';

  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'canvas-prop-input';
  input.value = value ?? '';
  input.placeholder = 'https://…';

  const commit = () => {
    const newVal = input.value.trim();
    if (newVal !== (value ?? '')) {
      onChange(newVal || null);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
  });

  wrap.appendChild(input);

  const link = document.createElement('a');
  link.className = 'canvas-prop-url-link';
  link.textContent = '🔗';
  link.title = 'Open link';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.href = value || '#';
  link.addEventListener('click', (e) => {
    if (!input.value.trim()) { e.preventDefault(); return; }
    link.href = input.value.trim();
  });
  // Keep link href synced
  input.addEventListener('input', () => {
    link.href = input.value.trim() || '#';
  });

  wrap.appendChild(link);
  return wrap;
}
