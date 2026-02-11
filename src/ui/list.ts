// list.ts — FilterableList UI component
//
// An input + scrollable list with fuzzy filtering and keyboard navigation.
// Used as the base for command palette, quick pick, and any other
// filterable selection UI.
//
// VS Code reference: `src/vs/base/browser/ui/list/listWidget.ts`,
//                    `src/vs/platform/quickinput/browser/quickInputList.ts`

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { InputBox, IInputBoxOptions } from './inputBox.js';
import { $, clearNode, addDisposableListener, toggleClass } from './dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IListItem<T = unknown> {
  /** Unique identifier. */
  readonly id: string;
  /** Primary label text (used for filtering). */
  readonly label: string;
  /** Secondary description (shown dimmed after the label). */
  readonly description?: string;
  /** Extra detail line (shown below the label). */
  readonly detail?: string;
  /** Optional badge text on the right side. */
  readonly badge?: string;
  /** Arbitrary payload data carried with the item. */
  readonly data?: T;
}

export interface IFilterableListOptions {
  /** Placeholder text for the filter input. */
  readonly placeholder?: string;
  /** Maximum number of visible items before scrolling. Default: 15. */
  readonly maxVisibleItems?: number;
  /**
   * Custom scoring function. Return a numeric score (lower = better match)
   * or -1 if the item doesn't match the query. If not provided, a built-in
   * fuzzy match is used.
   */
  readonly filterFn?: (query: string, item: IListItem) => number;
}

// ─── Built-in fuzzy match ────────────────────────────────────────────────────

function defaultFuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const gap = lastMatchIndex >= 0 ? ti - lastMatchIndex - 1 : ti;
      score += gap;
      lastMatchIndex = ti;
      qi++;
    }
  }

  return qi === q.length ? score : -1;
}

// ─── Internal scored item ────────────────────────────────────────────────────

interface ScoredItem<T> {
  item: IListItem<T>;
  score: number;
}

// ─── FilterableList ──────────────────────────────────────────────────────────

/**
 * An input field + scrollable list with keyboard navigation.
 *
 * CSS classes:
 * - `.ui-filterable-list` — wrapper
 * - `.ui-filterable-list-items` — scrollable item container
 * - `.ui-filterable-list-row` — individual row
 * - `.ui-filterable-list-row--selected` — keyboard-selected row
 * - `.ui-filterable-list-label` — main label span
 * - `.ui-filterable-list-description` — description span
 * - `.ui-filterable-list-badge` — badge span
 * - `.ui-filterable-list-empty` — "no results" message
 * - `.ui-filterable-list-more` — "N more…" indicator
 */
export class FilterableList<T = unknown> extends Disposable {

  readonly element: HTMLElement;

  private readonly _inputBox: InputBox;
  private readonly _listEl: HTMLElement;

  private _items: IListItem<T>[] = [];
  private _filtered: ScoredItem<T>[] = [];
  private _selectedIndex = 0;

  private readonly _maxVisible: number;
  private readonly _filterFn: (query: string, item: IListItem) => number;

  // ── Events ──

  private readonly _onDidSelect = this._register(new Emitter<IListItem<T>>());
  readonly onDidSelect: Event<IListItem<T>> = this._onDidSelect.event;

  private readonly _onDidCancel = this._register(new Emitter<void>());
  readonly onDidCancel: Event<void> = this._onDidCancel.event;

  constructor(container: HTMLElement, options?: IFilterableListOptions) {
    super();

    this._maxVisible = options?.maxVisibleItems ?? 15;
    this._filterFn = options?.filterFn ?? ((q, item) => defaultFuzzyScore(q, item.label));

    this.element = $('div.ui-filterable-list');

    // Input box
    this._inputBox = this._register(new InputBox(this.element, {
      placeholder: options?.placeholder ?? 'Type to filter…',
    }));

    // Listen for input changes and keyboard
    this._register(this._inputBox.onDidChange(() => this._applyFilter()));
    this._register(this._inputBox.onDidSubmit(() => this._selectCurrent()));
    this._register(this._inputBox.onDidCancel(() => this._onDidCancel.fire()));

    // Arrow key navigation (intercept before InputBox's keydown)
    this._register(addDisposableListener(this._inputBox.inputElement, 'keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._moveSelection(-1);
      }
    }));

    // List container
    this._listEl = $('div.ui-filterable-list-items');
    this._listEl.setAttribute('role', 'listbox');
    this.element.appendChild(this._listEl);

    container.appendChild(this.element);
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Set the full list of items. Refilters immediately.
   */
  setItems(items: IListItem<T>[]): void {
    this._items = items;
    this._applyFilter();
  }

  /**
   * Focus the filter input.
   */
  focus(): void {
    this._inputBox.focus();
  }

  /**
   * Get the current filter text.
   */
  get filterText(): string {
    return this._inputBox.value;
  }

  // ─── Internal: Filtering ───────────────────────────────────────────────

  private _applyFilter(): void {
    const query = this._inputBox.value;

    if (query.length === 0) {
      this._filtered = this._items.map(item => ({ item, score: 0 }));
    } else {
      this._filtered = [];
      for (const item of this._items) {
        const score = this._filterFn(query, item);
        if (score >= 0) {
          this._filtered.push({ item, score });
        }
      }
      this._filtered.sort((a, b) => a.score - b.score);
    }

    this._selectedIndex = this._filtered.length > 0 ? 0 : -1;
    this._render();
  }

  // ─── Internal: Rendering ───────────────────────────────────────────────

  private _render(): void {
    clearNode(this._listEl);

    if (this._filtered.length === 0) {
      const empty = $('div.ui-filterable-list-empty', 'No matching items');
      this._listEl.appendChild(empty);
      return;
    }

    const visible = this._filtered.slice(0, this._maxVisible);

    for (let i = 0; i < visible.length; i++) {
      const { item } = visible[i];

      const row = $('div.ui-filterable-list-row');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === this._selectedIndex ? 'true' : 'false');
      toggleClass(row, 'ui-filterable-list-row--selected', i === this._selectedIndex);

      // Label
      const labelEl = $('span.ui-filterable-list-label', item.label);
      row.appendChild(labelEl);

      // Description
      if (item.description) {
        const descEl = $('span.ui-filterable-list-description', item.description);
        row.appendChild(descEl);
      }

      // Badge
      if (item.badge) {
        const badgeEl = $('span.ui-filterable-list-badge', item.badge);
        row.appendChild(badgeEl);
      }

      // Mouse interaction
      addDisposableListener(row, 'mouseenter', () => {
        this._selectedIndex = i;
        this._updateSelectionVisuals();
      });

      addDisposableListener(row, 'click', (e) => {
        e.preventDefault();
        this._selectedIndex = i;
        this._selectCurrent();
      });

      this._listEl.appendChild(row);
    }

    // "N more…" indicator
    if (this._filtered.length > this._maxVisible) {
      const more = $('div.ui-filterable-list-more',
        `${this._filtered.length - this._maxVisible} more…`);
      this._listEl.appendChild(more);
    }
  }

  // ─── Internal: Selection ───────────────────────────────────────────────

  private _moveSelection(delta: number): void {
    if (this._filtered.length === 0) return;
    const maxIdx = Math.min(this._filtered.length, this._maxVisible) - 1;
    this._selectedIndex = Math.max(0, Math.min(maxIdx, this._selectedIndex + delta));
    this._updateSelectionVisuals();
  }

  private _updateSelectionVisuals(): void {
    const rows = this._listEl.querySelectorAll('.ui-filterable-list-row');
    rows.forEach((row, i) => {
      toggleClass(row as HTMLElement, 'ui-filterable-list-row--selected', i === this._selectedIndex);
      row.setAttribute('aria-selected', i === this._selectedIndex ? 'true' : 'false');
    });
  }

  private _selectCurrent(): void {
    const item = this._filtered[this._selectedIndex];
    if (item) {
      this._onDidSelect.fire(item.item);
    }
  }
}
