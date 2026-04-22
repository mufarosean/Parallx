// propertyEditors.ts — type-specific editor elements for the canvas property bar
//
// Factory function that creates an HTMLElement for each property type.
// Each editor calls onChange(newValue) when the user modifies the value.

import type { IPropertyDefinition, ISelectOption } from './propertyTypes.js';
import { createIconElement } from '../../../ui/iconRegistry.js';

// ─── Type Icon Map ───────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  text: 'text',
  number: 'hash',
  checkbox: 'square-check',
  date: 'calendar',
  datetime: 'clock',
  tags: 'tag',
  select: 'list',
  url: 'link',
};

export function getTypeIcon(type: string): string {
  return TYPE_ICONS[type] ?? 'text';
}

export function createTypeIconElement(type: string, size = 16): HTMLElement {
  return createIconElement(getTypeIcon(type), size);
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

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newVal = input.value.trim();
    if (newVal !== (value ?? '')) {
      onChange(newVal || null);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); input.blur(); }
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

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const raw = input.value.trim();
    const newVal = raw === '' ? null : Number(raw);
    if (newVal !== value) {
      onChange(newVal);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); input.blur(); }
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
  const trigger = document.createElement('button');
  trigger.className = 'canvas-prop-date-trigger';
  const dateStr = value ? value.substring(0, 10) : '';
  trigger.textContent = dateStr ? _formatDate(dateStr) : 'Empty';
  if (!dateStr) trigger.classList.add('canvas-prop-date-trigger--empty');

  let popup: HTMLElement | null = null;
  trigger.addEventListener('click', () => {
    if (popup) { popup.remove(); popup = null; return; }
    popup = _buildCalendar(
      dateStr ? new Date(dateStr + 'T00:00:00') : null,
      false,
      (iso) => {
        onChange(iso || null);
        trigger.textContent = iso ? _formatDate(iso) : 'Empty';
        trigger.classList.toggle('canvas-prop-date-trigger--empty', !iso);
        popup?.remove(); popup = null;
      },
      () => { popup = null; },
    );
    document.body.appendChild(popup);
    _positionBelow(popup, trigger);
  });

  return trigger;
}

// ─── Datetime ────────────────────────────────────────────────────────────────

function _createDatetimeEditor(value: string | null, onChange: (v: unknown) => void): HTMLElement {
  const trigger = document.createElement('button');
  trigger.className = 'canvas-prop-date-trigger';
  const dtStr = value ? value.replace(' ', 'T').substring(0, 16) : '';
  trigger.textContent = dtStr ? _formatDatetime(dtStr) : 'Empty';
  if (!dtStr) trigger.classList.add('canvas-prop-date-trigger--empty');

  let popup: HTMLElement | null = null;
  trigger.addEventListener('click', () => {
    if (popup) { popup.remove(); popup = null; return; }
    popup = _buildCalendar(
      dtStr ? new Date(dtStr) : null,
      true,
      (iso) => {
        onChange(iso || null);
        trigger.textContent = iso ? _formatDatetime(iso) : 'Empty';
        trigger.classList.toggle('canvas-prop-date-trigger--empty', !iso);
        popup?.remove(); popup = null;
      },
      () => { popup = null; },
    );
    document.body.appendChild(popup);
    _positionBelow(popup, trigger);
  });

  return trigger;
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

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newVal = input.value.trim();
    if (newVal !== (value ?? '')) {
      onChange(newVal || null);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); input.blur(); }
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

// ─── Calendar Helpers ────────────────────────────────────────────────────────

const _MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function _formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function _formatDatetime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function _positionBelow(popup: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const popH = popup.offsetHeight || 300;
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  if (spaceBelow >= popH) {
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 2}px`;
  } else {
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${Math.max(4, rect.top - popH - 2)}px`;
  }
}

function _pad2(n: number): string { return String(n).padStart(2, '0'); }

function _buildCalendar(
  selected: Date | null,
  showTime: boolean,
  onSelect: (iso: string) => void,
  onDismiss: () => void,
): HTMLElement {
  const today = new Date();
  let viewMonth = (selected ?? today).getMonth();
  let viewYear = (selected ?? today).getFullYear();
  let hours = selected ? selected.getHours() : today.getHours();
  let minutes = selected ? selected.getMinutes() : today.getMinutes();
  let selDay = selected ? selected.getDate() : -1;
  let selMonth = selected ? selected.getMonth() : -1;
  let selYear = selected ? selected.getFullYear() : -1;

  const el = document.createElement('div');
  el.className = 'canvas-prop-calendar';

  const render = () => {
    el.innerHTML = '';

    // ── Header: ◂ Month Year ▸
    const header = document.createElement('div');
    header.className = 'canvas-prop-calendar__header';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'canvas-prop-calendar__nav';
    prevBtn.textContent = '◂';
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });

    const title = document.createElement('span');
    title.className = 'canvas-prop-calendar__title';
    title.textContent = `${_MONTHS[viewMonth]} ${viewYear}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'canvas-prop-calendar__nav';
    nextBtn.textContent = '▸';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });

    header.append(prevBtn, title, nextBtn);
    el.appendChild(header);

    // ── Day-of-week labels
    const dowRow = document.createElement('div');
    dowRow.className = 'canvas-prop-calendar__dow';
    for (const d of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
      const cell = document.createElement('span');
      cell.textContent = d;
      dowRow.appendChild(cell);
    }
    el.appendChild(dowRow);

    // ── Day grid
    const grid = document.createElement('div');
    grid.className = 'canvas-prop-calendar__grid';

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('span');
      empty.className = 'canvas-prop-calendar__day canvas-prop-calendar__day--empty';
      grid.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dayEl = document.createElement('button');
      dayEl.className = 'canvas-prop-calendar__day';
      dayEl.textContent = String(d);

      if (d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()) {
        dayEl.classList.add('canvas-prop-calendar__day--today');
      }
      if (d === selDay && viewMonth === selMonth && viewYear === selYear) {
        dayEl.classList.add('canvas-prop-calendar__day--selected');
      }

      dayEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selDay = d; selMonth = viewMonth; selYear = viewYear;
        if (showTime) {
          render(); // re-render to highlight, user confirms via Done
        } else {
          onSelect(`${viewYear}-${_pad2(viewMonth + 1)}-${_pad2(d)}`);
        }
      });

      grid.appendChild(dayEl);
    }
    el.appendChild(grid);

    // ── Footer: Today / Clear
    const footer = document.createElement('div');
    footer.className = 'canvas-prop-calendar__footer';

    const todayBtn = document.createElement('button');
    todayBtn.className = 'canvas-prop-calendar__footer-btn';
    todayBtn.textContent = 'Today';
    todayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = new Date();
      selDay = now.getDate(); selMonth = now.getMonth(); selYear = now.getFullYear();
      viewMonth = selMonth; viewYear = selYear;
      hours = now.getHours(); minutes = now.getMinutes();
      if (!showTime) {
        onSelect(`${selYear}-${_pad2(selMonth + 1)}-${_pad2(selDay)}`);
      } else {
        render();
      }
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'canvas-prop-calendar__footer-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect('');
    });

    footer.append(todayBtn, clearBtn);
    el.appendChild(footer);

    // ── Time row (datetime only)
    if (showTime) {
      const timeRow = document.createElement('div');
      timeRow.className = 'canvas-prop-calendar__time';

      const hourInput = document.createElement('input');
      hourInput.type = 'number';
      hourInput.className = 'canvas-prop-calendar__time-input';
      hourInput.min = '0'; hourInput.max = '23';
      hourInput.value = _pad2(hours);
      hourInput.addEventListener('change', () => {
        hours = Math.min(23, Math.max(0, parseInt(hourInput.value) || 0));
        hourInput.value = _pad2(hours);
      });

      const sep = document.createElement('span');
      sep.className = 'canvas-prop-calendar__time-sep';
      sep.textContent = ':';

      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.className = 'canvas-prop-calendar__time-input';
      minInput.min = '0'; minInput.max = '59';
      minInput.value = _pad2(minutes);
      minInput.addEventListener('change', () => {
        minutes = Math.min(59, Math.max(0, parseInt(minInput.value) || 0));
        minInput.value = _pad2(minutes);
      });

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'canvas-prop-calendar__confirm';
      confirmBtn.textContent = 'Done';
      confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selDay > 0) {
          onSelect(`${selYear}-${_pad2(selMonth + 1)}-${_pad2(selDay)}T${_pad2(hours)}:${_pad2(minutes)}`);
        }
      });

      timeRow.append(hourInput, sep, minInput, confirmBtn);
      el.appendChild(timeRow);
    }
  };

  render();

  // Dismiss on outside click
  const dismiss = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) {
      el.remove();
      document.removeEventListener('mousedown', dismiss, true);
      onDismiss();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);

  return el;
}
