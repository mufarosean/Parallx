// iconPicker.ts — Reusable icon picker overlay
//
// Floating grid of icon buttons with optional search input and
// "Remove icon" button. Positioned near an anchor element,
// dismissed on outside click or Escape.
//
// VS Code reference: quick-pick overlay pattern adapted for icon selection.

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { layoutPopup } from './dom.js';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IIconPickerOptions {
  /** Anchor element used for positioning the picker. */
  readonly anchor: HTMLElement;
  /** Icon IDs to show in the grid. */
  readonly icons: readonly string[];
  /**
   * Renders an icon into an HTML string (e.g. returning an SVG string).
   * Called for each icon button in the grid.
   */
  readonly renderIcon: (iconId: string, size: number) => string;
  /** Whether to show the search input. Default: `true`. */
  readonly showSearch?: boolean;
  /** Whether to show a "Remove icon" button. Default: `false`. */
  readonly showRemove?: boolean;
  /** Icon size in pixels passed to `renderIcon`. Default: `22`. */
  readonly iconSize?: number;
}

// ─── IconPicker ──────────────────────────────────────────────────────────────

/**
 * A floating icon picker overlay.
 *
 * CSS classes (co-located in `iconPicker.css`):
 * - `.ui-icon-picker` — root overlay
 * - `.ui-icon-picker-search` — search input
 * - `.ui-icon-picker-remove` — remove button
 * - `.ui-icon-picker-content` — scrollable content area
 * - `.ui-icon-picker-grid` — icon grid
 * - `.ui-icon-picker-btn` — individual icon button
 * - `.ui-icon-picker-empty` — "no results" label
 *
 * Events:
 * - `onDidSelectIcon` — fired when an icon button is clicked (payload: icon ID)
 * - `onDidRemoveIcon` — fired when "Remove icon" is clicked
 * - `onDidDismiss` — fired when the picker is dismissed (outside click / Escape)
 *
 * Usage:
 * ```ts
 * const picker = new IconPicker(document.body, {
 *   anchor: myIconEl,
 *   icons: PAGE_ICON_IDS,
 *   renderIcon: (id, size) => svgIcon(id),
 *   showSearch: true,
 *   showRemove: true,
 * });
 * picker.onDidSelectIcon(id => { ... });
 * picker.onDidRemoveIcon(() => { ... });
 * // picker auto-disposes when dismissed.
 * ```
 */
export class IconPicker extends Disposable {

  // ── Events ──

  private readonly _onDidSelectIcon = this._register(new Emitter<string>());
  readonly onDidSelectIcon: Event<string> = this._onDidSelectIcon.event;

  private readonly _onDidRemoveIcon = this._register(new Emitter<void>());
  readonly onDidRemoveIcon: Event<void> = this._onDidRemoveIcon.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  // ── DOM ──

  private readonly _el: HTMLElement;
  private _dismissed = false;

  /** The root DOM element of the picker overlay. */
  get element(): HTMLElement { return this._el; }

  constructor(container: HTMLElement, private readonly _options: IIconPickerOptions) {
    super();

    const iconSize = _options.iconSize ?? 22;
    const showSearch = _options.showSearch !== false; // default true

    // Root overlay
    this._el = document.createElement('div');
    this._el.classList.add('ui-icon-picker');

    // Search input (optional)
    let searchInput: HTMLInputElement | null = null;
    if (showSearch) {
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search icons\u2026';
      searchInput.classList.add('ui-icon-picker-search');
      this._el.appendChild(searchInput);
    }

    // Remove button (optional)
    if (_options.showRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.classList.add('ui-icon-picker-remove');
      removeBtn.textContent = 'Remove icon';
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._onDidRemoveIcon.fire();
        this.dismiss();
      });
      this._el.appendChild(removeBtn);
    }

    // Scrollable content area
    const contentArea = document.createElement('div');
    contentArea.classList.add('ui-icon-picker-content');
    this._el.appendChild(contentArea);

    // Render icon grid
    const renderGrid = (filter?: string) => {
      contentArea.innerHTML = '';

      const grid = document.createElement('div');
      grid.classList.add('ui-icon-picker-grid');

      const ids = filter
        ? _options.icons.filter(id => id.includes(filter.toLowerCase()))
        : _options.icons;

      for (const id of ids) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('ui-icon-picker-btn');
        btn.title = id;
        btn.innerHTML = _options.renderIcon(id, iconSize);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('width', String(iconSize));
          svg.setAttribute('height', String(iconSize));
        }
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._onDidSelectIcon.fire(id);
          this.dismiss();
        });
        grid.appendChild(btn);
      }

      if (ids.length === 0) {
        const empty = document.createElement('div');
        empty.classList.add('ui-icon-picker-empty');
        empty.textContent = 'No matching icons';
        grid.appendChild(empty);
      }

      contentArea.appendChild(grid);
    };

    renderGrid();

    // Search handler
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput!.value.trim();
        renderGrid(q || undefined);
      });
    }

    // Mount
    container.appendChild(this._el);

    // Position near anchor, clamped to viewport
    this._positionNearAnchor();

    // Focus search if shown
    if (searchInput) {
      setTimeout(() => searchInput!.focus(), 0);
    }

    // Outside click to dismiss
    this._register(this._listenOutsideClick());

    // Escape to dismiss
    this._register(this._listenEscape());

    // Clean up DOM on dispose
    this._register(toDisposable(() => {
      if (this._el.parentNode) this._el.remove();
    }));
  }

  /** Programmatically dismiss the picker. */
  dismiss(): void {
    if (this._dismissed) return;
    this._dismissed = true;
    this._onDidDismiss.fire();
    this.dispose();
  }

  // ── Positioning ────────────────────────────────────────────────────────

  private _positionNearAnchor(): void {
    const anchorRect = this._options.anchor.getBoundingClientRect();
    layoutPopup(this._el, anchorRect, { position: 'below', gap: 4 });
  }

  // ── Dismiss listeners ──────────────────────────────────────────────────

  private _listenOutsideClick() {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (this._el.contains(target)) return;
      if (this._options.anchor.contains(target)) return;
      this.dismiss();
    };

    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handler, true);
    }, 0);

    return toDisposable(() => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handler, true);
    });
  }

  private _listenEscape() {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.dismiss();
      }
    };

    document.addEventListener('keydown', handler, true);
    return toDisposable(() => {
      document.removeEventListener('keydown', handler, true);
    });
  }
}
