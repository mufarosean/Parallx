// dropdown.ts — Dropdown UI component
//
// Single-select dropdown that renders as a button which opens a
// positioned option list. Supports keyboard navigation.
//
// VS Code reference: `src/vs/base/browser/ui/dropdown/dropdown.ts`

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener } from './dom.js';
import './dropdown.css';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IDropdownItem {
  readonly value: string;
  readonly label: string;
}

export interface IDropdownOptions {
  /** Items to show in the dropdown list. */
  readonly items?: readonly IDropdownItem[];
  /** Initially selected value. */
  readonly selected?: string;
  /** Placeholder text when nothing is selected. */
  readonly placeholder?: string;
  /** Accessible label for screen readers. */
  readonly ariaLabel?: string;
  /** Whether the dropdown is disabled. */
  readonly disabled?: boolean;
}

// ─── Dropdown ────────────────────────────────────────────────────────────────

/**
 * A single-select dropdown.
 *
 * CSS classes (co-located in `dropdown.css`):
 * - `.ui-dropdown` — wrapper
 * - `.ui-dropdown__button` — the trigger button
 * - `.ui-dropdown__chevron` — down arrow indicator
 * - `.ui-dropdown__list` — the options list (positioned)
 * - `.ui-dropdown__item` — individual option
 * - `.ui-dropdown__item--selected` — the currently selected item
 * - `.ui-dropdown__item--focused` — keyboard-focused item
 * - `.ui-dropdown--open` — added when the list is visible
 * - `.ui-dropdown--disabled` — added when disabled
 *
 * Events:
 * - `onDidChange` — fired when the selected value changes (payload: value string)
 */
export class Dropdown extends Disposable {

  readonly element: HTMLElement;
  private readonly _button: HTMLButtonElement;
  private readonly _list: HTMLElement;
  private _items: IDropdownItem[];
  private _selectedValue: string | undefined;
  private _isOpen = false;
  private _focusedIndex = -1;
  private _disabled: boolean;

  private readonly _onDidChange = this._register(new Emitter<string>());
  readonly onDidChange: Event<string> = this._onDidChange.event;

  constructor(container: HTMLElement, options?: IDropdownOptions) {
    super();

    this._items = options?.items ? [...options.items] : [];
    this._selectedValue = options?.selected;
    this._disabled = options?.disabled ?? false;

    // Wrapper
    this.element = $('div.ui-dropdown');
    if (this._disabled) {
      this.element.classList.add('ui-dropdown--disabled');
    }

    // Trigger button
    this._button = document.createElement('button');
    this._button.type = 'button';
    this._button.className = 'ui-dropdown__button';
    if (options?.ariaLabel) {
      this._button.setAttribute('aria-label', options.ariaLabel);
    }
    this._button.setAttribute('aria-haspopup', 'listbox');
    this._button.setAttribute('aria-expanded', 'false');
    if (this._disabled) {
      this._button.disabled = true;
    }

    this._updateButtonText(options?.placeholder ?? '');
    const chevron = $('span.ui-dropdown__chevron', '\u25BE'); // ▾
    this._button.appendChild(chevron);
    this.element.appendChild(this._button);

    // Options list
    this._list = $('div.ui-dropdown__list');
    this._list.setAttribute('role', 'listbox');
    this._renderItems();
    this.element.appendChild(this._list);

    // Toggle on click
    this._register(addDisposableListener(this._button, 'click', () => {
      if (this._disabled) return;
      if (this._isOpen) {
        this._close();
      } else {
        this._open();
      }
    }));

    // Keyboard navigation
    this._register(addDisposableListener(this.element, 'keydown', (e) => {
      if (this._disabled) return;
      this._handleKeydown(e);
    }));

    // Close on outside click
    const outsideClick = (e: MouseEvent) => {
      if (this._isOpen && !this.element.contains(e.target as Node)) {
        this._close();
      }
    };
    document.addEventListener('mousedown', outsideClick, true);
    this._register(toDisposable(() => document.removeEventListener('mousedown', outsideClick, true)));

    container.appendChild(this.element);
  }

  // ─── Properties ──────────────────────────────────────────────────────

  get value(): string | undefined {
    return this._selectedValue;
  }

  set value(v: string | undefined) {
    this._selectedValue = v;
    this._updateButtonText();
    this._updateSelectedClass();
  }

  get items(): readonly IDropdownItem[] {
    return this._items;
  }

  set items(newItems: readonly IDropdownItem[]) {
    this._items = [...newItems];
    this._renderItems();
    this._updateButtonText();
  }

  get disabled(): boolean {
    return this._disabled;
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this._button.disabled = v;
    this.element.classList.toggle('ui-dropdown--disabled', v);
    if (v && this._isOpen) this._close();
  }

  // ─── Methods ─────────────────────────────────────────────────────────

  focus(): void {
    this._button.focus();
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _updateButtonText(placeholder?: string): void {
    const item = this._items.find(i => i.value === this._selectedValue);
    // Preserve the chevron — update only the text before it
    const textNode = this._button.firstChild;
    const text = item?.label ?? placeholder ?? '';
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = text;
    } else {
      this._button.insertBefore(document.createTextNode(text), this._button.firstChild);
    }
  }

  private _renderItems(): void {
    this._list.innerHTML = '';
    this._items.forEach((item) => {
      const el = $('div.ui-dropdown__item', item.label);
      el.setAttribute('role', 'option');
      el.dataset.value = item.value;
      if (item.value === this._selectedValue) {
        el.classList.add('ui-dropdown__item--selected');
        el.setAttribute('aria-selected', 'true');
      }
      this._register(addDisposableListener(el, 'click', (e) => {
        e.stopPropagation();
        this._select(item.value);
        this._close();
      }));
      this._list.appendChild(el);
    });
  }

  private _updateSelectedClass(): void {
    const items = this._list.querySelectorAll('.ui-dropdown__item');
    items.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const isSelected = htmlEl.dataset.value === this._selectedValue;
      htmlEl.classList.toggle('ui-dropdown__item--selected', isSelected);
      htmlEl.setAttribute('aria-selected', String(isSelected));
    });
  }

  private _select(value: string): void {
    if (this._selectedValue === value) return;
    this._selectedValue = value;
    this._updateButtonText();
    this._updateSelectedClass();
    this._onDidChange.fire(value);
  }

  private _open(): void {
    this._isOpen = true;
    this.element.classList.add('ui-dropdown--open');
    this._button.setAttribute('aria-expanded', 'true');
    this._focusedIndex = this._items.findIndex(i => i.value === this._selectedValue);
    this._updateFocusedClass();
  }

  private _close(): void {
    this._isOpen = false;
    this.element.classList.remove('ui-dropdown--open');
    this._button.setAttribute('aria-expanded', 'false');
    this._focusedIndex = -1;
    this._updateFocusedClass();
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (!this._isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._open();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._focusedIndex = Math.min(this._focusedIndex + 1, this._items.length - 1);
        this._updateFocusedClass();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._focusedIndex = Math.max(this._focusedIndex - 1, 0);
        this._updateFocusedClass();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this._focusedIndex >= 0 && this._focusedIndex < this._items.length) {
          this._select(this._items[this._focusedIndex].value);
        }
        this._close();
        break;
      case 'Escape':
        e.preventDefault();
        this._close();
        break;
    }
  }

  private _updateFocusedClass(): void {
    const items = this._list.querySelectorAll('.ui-dropdown__item');
    items.forEach((el, idx) => {
      (el as HTMLElement).classList.toggle('ui-dropdown__item--focused', idx === this._focusedIndex);
    });
  }
}
