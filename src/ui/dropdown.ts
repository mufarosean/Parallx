// dropdown.ts — Dropdown UI component
//
// Single-select dropdown that renders as a button which opens a
// positioned option list. Supports keyboard navigation.
//
// VS Code reference: `src/vs/base/browser/ui/dropdown/dropdown.ts`

import { Disposable, toDisposable, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener, layoutPopup } from './dom.js';
import './dropdown.css';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IDropdownItem {
  readonly value: string;
  readonly label: string;
  /**
   * Optional colour chip shown before the label, in the list AND on the trigger.
   *
   * Added because the alternative was worse: the Budget extension's category
   * picker identifies categories by colour (the palette is per-category data,
   * designed over two migrations), and without this the only way to keep that
   * was a hand-rolled clone of this component — which is exactly what existed,
   * and which carried its own bugs. A capability the one dropdown lacks is a
   * capability that gets reimplemented badly somewhere else.
   */
  readonly color?: string;
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
 * The open list lives in a `position: fixed` layer on `document.body`, NOT inside
 * the wrapper. That is the difference between this being usable everywhere and
 * only usable in unclipped layouts: an absolutely-positioned list inside the
 * wrapper is clipped by any ancestor whose `overflow` is not `visible`, so a
 * dropdown in a scrolling table — Budget's transaction rows, the planner's lists
 * — had its options cut off by the scroll container. That single limitation is
 * why hand-rolled clones of this component existed at all.
 *
 * CSS classes (co-located in `dropdown.css`):
 * - `.ui-dropdown` — wrapper
 * - `.ui-dropdown__button` — the trigger button
 * - `.ui-dropdown__swatch` — optional colour chip (trigger and items)
 * - `.ui-dropdown__label` — the trigger's text
 * - `.ui-dropdown__chevron` — down arrow indicator
 * - `.ui-dropdown__list` — the options list (body-level, `position: fixed`)
 * - `.ui-dropdown__item` — individual option
 * - `.ui-dropdown__item--selected` — the currently selected item
 * - `.ui-dropdown__item--focused` — keyboard-focused item
 * - `.ui-dropdown--open` — added to the WRAPPER while the list is visible
 * - `.ui-dropdown--disabled` — added when disabled
 *
 * Events:
 * - `onDidChange` — fired when the selected value changes (payload: value string)
 */
export class Dropdown extends Disposable {

  readonly element: HTMLElement;
  private readonly _button: HTMLButtonElement;
  private readonly _label: HTMLElement;
  private readonly _list: HTMLElement;
  private _swatch: HTMLElement | undefined;
  private _items: IDropdownItem[];
  private _selectedValue: string | undefined;
  private _placeholder: string;
  private _isOpen = false;
  private _focusedIndex = -1;
  private _disabled: boolean;

  private readonly _onDidChange = this._register(new Emitter<string>());
  readonly onDidChange: Event<string> = this._onDidChange.event;

  constructor(container: HTMLElement, options?: IDropdownOptions) {
    super();

    this._items = options?.items ? [...options.items] : [];
    this._selectedValue = options?.selected;
    this._placeholder = options?.placeholder ?? '';
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

    // Structured children rather than text-node surgery. The previous version
    // hunted for `firstChild` and assumed it was the label, which made putting
    // anything before the text (a colour swatch) impossible without breaking it.
    this._label = $('span.ui-dropdown__label');
    this._button.appendChild(this._label);
    const chevron =$('span.ui-dropdown__chevron', '\u25BE'); // ▾
    this._button.appendChild(chevron);
    this.element.appendChild(this._button);
    this._updateButtonText();

    // Options list — built now, attached to document.body only while open.
    this._list = $('div.ui-dropdown__list');
    this._list.setAttribute('role', 'listbox');
    this._renderItems();

    // Toggle on click
    this._register(addDisposableListener(this._button, 'click', () => {
      if (this._disabled) return;
      if (this._isOpen) {
        this._close();
      } else {
        this._open();
      }
    }));

    // Keyboard navigation. Focus stays on the trigger while the list is open —
    // the list is a listbox of non-focusable rows driven by _focusedIndex — so
    // binding to the wrapper still receives every key even though the list is
    // now mounted elsewhere in the DOM.
    this._register(addDisposableListener(this.element, 'keydown', (e) => {
      if (this._disabled) return;
      this._handleKeydown(e);
    }));

    // Close on outside click. Has to consider the list too, now that it is not a
    // descendant of the wrapper — otherwise clicking an option would count as
    // "outside" and close the list before the option's own handler ran.
    const outsideClick = (e: MouseEvent) => {
      if (!this._isOpen) return;
      const target = e.target as Node;
      if (this.element.contains(target) || this._list.contains(target)) return;
      this._close();
    };
    document.addEventListener('mousedown', outsideClick, true);
    this._register(toDisposable(() => document.removeEventListener('mousedown', outsideClick, true)));

    // Dismiss when the world moves under a fixed-position list.
    //
    // The scroll listener has to be capture-phase on window to see scrolling in
    // arbitrary ancestor containers, and capture propagation runs
    // window -> document -> ... -> target — so it ALSO fires for scroll events
    // targeting descendants, including this list's own scroller. Without the
    // containment guard, a list long enough to scroll dismisses itself on the
    // first wheel tick. That was a real shipped bug in the hand-rolled clone this
    // component replaces, and the guard is the only reason it cannot recur here.
    // `globalThis.Event` because the platform's generic `Event<T>` emitter type
    // is imported into this module and shadows the DOM one.
    const onScroll = (e: globalThis.Event) => {
      if (!this._isOpen) return;
      const target = e.target;
      if (target instanceof Node && this._list.contains(target)) return;
      this._close();
    };
    const onResize = () => { if (this._isOpen) this._close(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    this._register(toDisposable(() => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    }));

    // Close when keyboard focus leaves the component. The outside-close above
    // is mousedown-only, so Tabbing to the NEXT dropdown and opening it with
    // Enter would leave two body-level lists open at once, painting over each
    // other. relatedTarget guard: focus moving INTO our own list (or staying
    // on the trigger) must not dismiss.
    this._register(addDisposableListener(this.element, 'focusout', (e) => {
      if (!this._isOpen) return;
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (next && (this.element.contains(next) || this._list.contains(next))) return;
      this._close();
    }));

    // A list left mounted on body after its owner is disposed is a leaked
    // overlay floating over unrelated UI.
    this._register(toDisposable(() => this._list.remove()));

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

  /**
   * Repaint the trigger from the current selection.
   *
   * The placeholder is read from state rather than taken as an argument. As a
   * parameter it was supplied only by the constructor, so the first `value = ` or
   * `items = ` assignment replaced "Pick a category" with an empty button —
   * silently, and for every consumer that populates its items asynchronously.
   */
  private _updateButtonText(): void {
    const item = this._items.find(i => i.value === this._selectedValue);

    if (this._swatch) { this._swatch.remove(); this._swatch = undefined; }
    if (item?.color) {
      this._swatch = $('span.ui-dropdown__swatch');
      this._swatch.style.background = item.color;
      this._button.insertBefore(this._swatch, this._label);
    }

    this._label.textContent = item?.label ?? this._placeholder;
    this._label.classList.toggle('ui-dropdown__label--placeholder', !item);
  }

  private _renderItems(): void {
    this._list.innerHTML = '';
    this._items.forEach((item) => {
      const el = $('div.ui-dropdown__item');
      el.setAttribute('role', 'option');
      el.dataset.value = item.value;
      if (item.color) {
        const sw = $('span.ui-dropdown__swatch');
        sw.style.background = item.color;
        el.appendChild(sw);
      }
      el.appendChild($('span.ui-dropdown__item-label', item.label));
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

    // Mount into the body layer, then position. Appending first is required:
    // layoutPopup measures offsetWidth/offsetHeight, which are 0 while detached.
    const rect = this._button.getBoundingClientRect();
    // Match the trigger's width so the list reads as belonging to it, but let a
    // long label widen it rather than truncating every option.
    this._list.style.minWidth = `${rect.width}px`;
    // Cleared each open: layoutPopup sets maxHeight when space is tight, and a
    // value left over from a previous open in a tighter spot would stick.
    this._list.style.maxHeight = '';
    document.body.appendChild(this._list);
    layoutPopup(this._list, rect, { position: 'below' });

    this._focusedIndex = this._items.findIndex(i => i.value === this._selectedValue);
    this._updateFocusedClass();
  }

  private _close(): void {
    this._isOpen = false;
    this.element.classList.remove('ui-dropdown--open');
    this._button.setAttribute('aria-expanded', 'false');
    this._focusedIndex = -1;
    this._updateFocusedClass();
    this._list.remove();
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
      const focused = idx === this._focusedIndex;
      (el as HTMLElement).classList.toggle('ui-dropdown__item--focused', focused);
      if (focused) {
        // The list scrolls now, so arrowing past the fold has to bring the row
        // into view or keyboard navigation walks into invisible options.
        // Optional-called: jsdom does not implement scrollIntoView, and a missing
        // scroll nicety must not throw inside a keydown handler.
        (el as HTMLElement).scrollIntoView?.({ block: 'nearest' });
      }
    });
  }
}

// ─── Extension-facing handle ─────────────────────────────────────────────────

/** The shape `api.ui.createDropdown` returns. Mirrors `DropdownHandle` in parallx.d.ts. */
export interface IDropdownHandle {
  readonly element: HTMLElement;
  value: string;
  setItems(items: readonly IDropdownItem[], selected?: string): void;
  onDidChange(listener: (value: string) => void): IDisposable;
  focus(): void;
  setDisabled(disabled: boolean): void;
  dispose(): void;
}

/**
 * Build the handle that `api.ui.createDropdown` hands to extensions.
 *
 * Lives here rather than inline in apiFactory so the extension-facing surface and
 * the component it wraps stay in one file — and so a test can exercise exactly
 * the code path an extension gets, instead of a hand-written stand-in that can
 * drift away from the real thing.
 */
export function createDropdownHandle(
  container: HTMLElement,
  options?: IDropdownOptions,
): IDropdownHandle {
  const dropdown = new Dropdown(container, options);
  return {
    element: dropdown.element,
    get value(): string { return dropdown.value ?? ''; },
    set value(v: string) { dropdown.value = v; },
    /**
     * Swap the option set, optionally setting the value in the same call.
     *
     * The paired form matters for dependent dropdowns: setting items and then
     * value as two statements repaints the trigger twice and, in between, shows
     * the placeholder because the old value is not in the new list.
     */
    setItems(items: readonly IDropdownItem[], selected?: string): void {
      dropdown.items = items;
      if (selected !== undefined) dropdown.value = selected;
    },
    onDidChange(listener: (value: string) => void): IDisposable {
      return dropdown.onDidChange(listener);
    },
    focus(): void { dropdown.focus(); },
    setDisabled(disabled: boolean): void { dropdown.disabled = disabled; },
    dispose(): void { dropdown.dispose(); },
  };
}
