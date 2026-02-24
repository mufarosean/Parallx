// propertyEditors.ts — Inline cell editors for database property values
//
// Each editor extends Disposable, accepts a container + current value,
// and fires onDidChange when the value is committed. Editors are created
// by createPropertyEditor() and destroyed when the cell loses focus.
//
// IPropertyValue is a discriminated union where each variant stores its
// payload in a type-specific property (e.g. `title: [...]`, not `value: ...`).
//
// Dependencies: platform/ (lifecycle, events), ui/ (dom, contextMenu),
// databaseRegistry (type-only)

import { Disposable } from '../../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../../platform/events.js';
import { $, addDisposableListener } from '../../../../ui/dom.js';
import { ContextMenu, type IContextMenuItem } from '../../../../ui/contextMenu.js';
import type {
  PropertyType,
  PropertyConfig,
  IPropertyValue,
  ISelectOption,
  ISelectPropertyConfig,
  IMultiSelectPropertyConfig,
  IStatusPropertyConfig,
  IRichTextSegment,
  IFileReference,
} from '../databaseRegistry.js';

// ─── Base Editor ─────────────────────────────────────────────────────────────

export interface IPropertyEditor extends Disposable {
  readonly onDidChange: Event<IPropertyValue>;
  readonly onDidDismiss: Event<void>;
  focus(): void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a plain string to a single-segment rich text array. */
function textToRichText(text: string): IRichTextSegment[] {
  return text ? [{ type: 'text', content: text }] : [];
}

/** Extract plain text from an array of IRichTextSegment. */
function richTextToPlainText(segments: readonly IRichTextSegment[]): string {
  return segments.map(s => s.content).join('');
}

// ─── Text-based Editors ──────────────────────────────────────────────────────

class TextInputEditor extends Disposable implements IPropertyEditor {
  private readonly _input: HTMLInputElement;
  private _committed = false;

  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  constructor(
    container: HTMLElement,
    private readonly _type: 'title' | 'rich_text' | 'url' | 'email' | 'phone_number',
    currentValue: string,
    inputType: string = 'text',
  ) {
    super();

    this._input = document.createElement('input');
    this._input.type = inputType;
    this._input.classList.add('db-cell-editor-input');
    this._input.value = currentValue;
    container.appendChild(this._input);

    this._register(addDisposableListener(this._input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._onDidDismiss.fire();
      }
      e.stopPropagation();
    }));

    this._register(addDisposableListener(this._input, 'blur', () => {
      this._commit();
    }));
  }

  private _commit(): void {
    if (this._committed) return;
    this._committed = true;

    const val = this._input.value;
    let propValue: IPropertyValue;

    switch (this._type) {
      case 'title':
        propValue = { type: 'title', title: textToRichText(val) };
        break;
      case 'rich_text':
        propValue = { type: 'rich_text', rich_text: textToRichText(val) };
        break;
      case 'url':
        propValue = { type: 'url', url: val || null };
        break;
      case 'email':
        propValue = { type: 'email', email: val || null };
        break;
      case 'phone_number':
        propValue = { type: 'phone_number', phone_number: val || null };
        break;
    }

    this._onDidChange.fire(propValue);
    this._onDidDismiss.fire();
  }

  focus(): void {
    this._input.focus();
    this._input.select();
  }
}

// ─── Number Editor ───────────────────────────────────────────────────────────

class NumberEditor extends Disposable implements IPropertyEditor {
  private readonly _input: HTMLInputElement;
  private _committed = false;

  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  constructor(container: HTMLElement, currentValue: number | null) {
    super();

    this._input = document.createElement('input');
    this._input.type = 'number';
    this._input.classList.add('db-cell-editor-input');
    this._input.value = currentValue != null ? String(currentValue) : '';
    this._input.step = 'any';
    container.appendChild(this._input);

    this._register(addDisposableListener(this._input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._onDidDismiss.fire();
      }
      e.stopPropagation();
    }));

    this._register(addDisposableListener(this._input, 'blur', () => {
      this._commit();
    }));
  }

  private _commit(): void {
    if (this._committed) return;
    this._committed = true;

    const raw = this._input.value.trim();
    const num = raw === '' ? null : Number(raw);
    if (raw !== '' && isNaN(num!)) return;
    this._onDidChange.fire({ type: 'number', number: num });
    this._onDidDismiss.fire();
  }

  focus(): void {
    this._input.focus();
    this._input.select();
  }
}

// ─── Checkbox Editor ─────────────────────────────────────────────────────────

class CheckboxEditor extends Disposable implements IPropertyEditor {
  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  constructor(currentValue: boolean) {
    super();
    // Checkbox toggles immediately — no popup needed
    this._onDidChange.fire({ type: 'checkbox', checkbox: !currentValue });
    queueMicrotask(() => this._onDidDismiss.fire());
  }

  focus(): void {
    // No focusable element — toggle already happened
  }
}

// ─── Select Editor ───────────────────────────────────────────────────────────

class SelectEditor extends Disposable implements IPropertyEditor {
  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  private _dismissed = false;

  constructor(
    anchor: HTMLElement,
    config: ISelectPropertyConfig | undefined,
    currentOption: ISelectOption | null,
  ) {
    super();

    const options = config?.options ?? [];
    const items: IContextMenuItem[] = [
      {
        id: '__clear__',
        label: 'None',
        className: currentOption == null ? 'context-menu-item--selected' : '',
      },
      ...options.map((opt: ISelectOption) => ({
        id: opt.id,
        label: opt.name,
        className: opt.id === currentOption?.id ? 'context-menu-item--selected' : '',
        renderIcon: (iconContainer: HTMLElement) => {
          const dot = $('span.db-option-dot');
          dot.style.backgroundColor = opt.color;
          iconContainer.appendChild(dot);
        },
      })),
    ];

    const rect = anchor.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    this._register(menu);

    // onDidSelect fires first, then dismiss() auto-fires onDidDismiss.
    // Use _dismissed guard to prevent double-fire of onDidDismiss.
    menu.onDidSelect(e => {
      if (e.item.id === '__clear__') {
        this._onDidChange.fire({ type: 'select', select: null });
      } else {
        const selected = options.find(o => o.id === e.item.id) ?? null;
        this._onDidChange.fire({ type: 'select', select: selected });
      }
      // dismiss() triggers onDidDismiss, which will fire _onDidDismiss once
    });

    menu.onDidDismiss(() => {
      if (this._dismissed) return;
      this._dismissed = true;
      this._onDidDismiss.fire();
    });
  }

  focus(): void {
    // ContextMenu handles its own focus
  }
}

// ─── Multi-Select Editor ─────────────────────────────────────────────────────

class MultiSelectEditor extends Disposable implements IPropertyEditor {
  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  private _selectedIds: Set<string>;

  constructor(
    anchor: HTMLElement,
    config: IMultiSelectPropertyConfig | undefined,
    currentOptions: ISelectOption[],
  ) {
    super();
    this._selectedIds = new Set(currentOptions.map(o => o.id));

    const options = config?.options ?? [];
    const items: IContextMenuItem[] = options.map((opt: ISelectOption) => ({
      id: opt.id,
      label: `${this._selectedIds.has(opt.id) ? '✓ ' : '   '}${opt.name}`,
      renderIcon: (iconContainer: HTMLElement) => {
        const dot = $('span.db-option-dot');
        dot.style.backgroundColor = opt.color;
        iconContainer.appendChild(dot);
      },
    }));

    const rect = anchor.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    this._register(menu);

    menu.onDidSelect(e => {
      if (this._selectedIds.has(e.item.id)) {
        this._selectedIds.delete(e.item.id);
      } else {
        this._selectedIds.add(e.item.id);
      }
      const selected = options.filter(o => this._selectedIds.has(o.id));
      this._onDidChange.fire({ type: 'multi_select', multi_select: selected });
    });

    menu.onDidDismiss(() => {
      this._onDidDismiss.fire();
    });
  }

  focus(): void {
    // ContextMenu handles its own focus
  }
}

// ─── Status Editor ───────────────────────────────────────────────────────────

class StatusEditor extends Disposable implements IPropertyEditor {
  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  private _dismissed = false;

  constructor(
    anchor: HTMLElement,
    config: IStatusPropertyConfig | undefined,
    currentOption: ISelectOption | null,
  ) {
    super();

    // Build grouped items (groups contain optionIds → look up in config.options)
    const allOptions = config?.options ?? [];
    const items: IContextMenuItem[] = [];

    if (config?.groups) {
      for (const group of config.groups) {
        // Group separator — must be disabled to prevent click from clearing status
        if (items.length > 0) {
          items.push({ id: `__sep_${group.id}`, label: '', group: group.name, disabled: true });
        }
        for (const optionId of group.optionIds) {
          const opt = allOptions.find(o => o.id === optionId);
          if (!opt) continue;
          items.push({
            id: opt.id,
            label: opt.name,
            group: group.name,
            className: opt.id === currentOption?.id ? 'context-menu-item--selected' : '',
            renderIcon: (iconContainer: HTMLElement) => {
              const dot = $('span.db-option-dot');
              dot.style.backgroundColor = opt.color;
              iconContainer.appendChild(dot);
            },
          });
        }
      }
    } else {
      // Fallback: show flat option list
      for (const opt of allOptions) {
        items.push({
          id: opt.id,
          label: opt.name,
          className: opt.id === currentOption?.id ? 'context-menu-item--selected' : '',
        });
      }
    }

    const rect = anchor.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    this._register(menu);

    menu.onDidSelect(e => {
      const selected = allOptions.find(o => o.id === e.item.id) ?? null;
      this._onDidChange.fire({ type: 'status', status: selected });
      // dismiss() auto-fires onDidDismiss, guard below prevents double-fire
    });

    menu.onDidDismiss(() => {
      if (this._dismissed) return;
      this._dismissed = true;
      this._onDidDismiss.fire();
    });
  }

  focus(): void {
    // ContextMenu handles its own focus
  }
}

// ─── Date Editor ─────────────────────────────────────────────────────────────

class DateEditor extends Disposable implements IPropertyEditor {
  private readonly _input: HTMLInputElement;

  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  constructor(
    container: HTMLElement,
    currentDate: { start: string; end: string | null; time_zone?: string } | null,
  ) {
    super();

    this._input = document.createElement('input');
    this._input.type = 'date';
    this._input.classList.add('db-cell-editor-input', 'db-cell-editor-date');
    if (currentDate?.start) {
      this._input.value = currentDate.start.slice(0, 10);
    }
    container.appendChild(this._input);

    this._register(addDisposableListener(this._input, 'change', () => {
      const val = this._input.value;
      if (val) {
        this._onDidChange.fire({
          type: 'date',
          date: { start: val, end: currentDate?.end ?? null },
        });
      } else {
        this._onDidChange.fire({ type: 'date', date: null });
      }
      this._onDidDismiss.fire();
    }));

    this._register(addDisposableListener(this._input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._onDidDismiss.fire();
      }
      e.stopPropagation();
    }));

    this._register(addDisposableListener(this._input, 'blur', () => {
      this._onDidDismiss.fire();
    }));
  }

  focus(): void {
    this._input.focus();
    try { this._input.showPicker?.(); } catch { /* not supported */ }
  }
}

// ─── Files Editor ────────────────────────────────────────────────────────────

class FilesEditor extends Disposable implements IPropertyEditor {
  private readonly _input: HTMLInputElement;
  private readonly _currentFiles: IFileReference[];

  private readonly _onDidChange = this._register(new Emitter<IPropertyValue>());
  readonly onDidChange: Event<IPropertyValue> = this._onDidChange.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  constructor(container: HTMLElement, currentFiles: IFileReference[]) {
    super();
    this._currentFiles = [...currentFiles];

    this._input = document.createElement('input');
    this._input.type = 'url';
    this._input.classList.add('db-cell-editor-input');
    this._input.placeholder = 'Paste file URL…';
    container.appendChild(this._input);

    this._register(addDisposableListener(this._input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._addFile();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._onDidDismiss.fire();
      }
      e.stopPropagation();
    }));

    this._register(addDisposableListener(this._input, 'blur', () => {
      if (this._input.value.trim()) {
        this._addFile();
      } else {
        this._onDidDismiss.fire();
      }
    }));
  }

  private _addFile(): void {
    const url = this._input.value.trim();
    if (!url) { this._onDidDismiss.fire(); return; }
    const name = url.split('/').pop() || 'File';
    this._currentFiles.push({ name, type: 'external', external: { url } });
    this._onDidChange.fire({ type: 'files', files: [...this._currentFiles] });
    this._onDidDismiss.fire();
  }

  focus(): void {
    this._input.focus();
  }
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Create an inline editor for a property value.
 * Returns null for read-only types (timestamps, formula, rollup, unique_id).
 */
export function createPropertyEditor(
  type: PropertyType,
  container: HTMLElement,
  anchor: HTMLElement,
  value: IPropertyValue | undefined,
  config: PropertyConfig,
): IPropertyEditor | null {
  switch (type) {
    case 'title': {
      const text = value?.type === 'title' ? richTextToPlainText(value.title) : '';
      return new TextInputEditor(container, 'title', text);
    }
    case 'rich_text': {
      const text = value?.type === 'rich_text' ? richTextToPlainText(value.rich_text) : '';
      return new TextInputEditor(container, 'rich_text', text);
    }
    case 'number':
      return new NumberEditor(container, value?.type === 'number' ? value.number : null);
    case 'select':
      return new SelectEditor(
        anchor,
        config as ISelectPropertyConfig,
        value?.type === 'select' ? value.select : null,
      );
    case 'multi_select':
      return new MultiSelectEditor(
        anchor,
        config as IMultiSelectPropertyConfig,
        value?.type === 'multi_select' ? value.multi_select : [],
      );
    case 'status':
      return new StatusEditor(
        anchor,
        config as IStatusPropertyConfig,
        value?.type === 'status' ? value.status : null,
      );
    case 'date':
      return new DateEditor(container, value?.type === 'date' ? value.date : null);
    case 'checkbox':
      return new CheckboxEditor(value?.type === 'checkbox' ? value.checkbox : false);
    case 'url':
      return new TextInputEditor(container, 'url', value?.type === 'url' ? value.url ?? '' : '', 'url');
    case 'email':
      return new TextInputEditor(container, 'email', value?.type === 'email' ? value.email ?? '' : '', 'email');
    case 'phone_number':
      return new TextInputEditor(container, 'phone_number', value?.type === 'phone_number' ? value.phone_number ?? '' : '', 'tel');
    case 'files':
      return new FilesEditor(container, value?.type === 'files' ? value.files : []);

    // Read-only types — no editor
    case 'created_time':
    case 'last_edited_time':
    case 'relation':
    case 'rollup':
    case 'formula':
    case 'unique_id':
      return null;

    default:
      return null;
  }
}
