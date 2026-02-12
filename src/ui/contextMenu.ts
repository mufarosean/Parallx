// contextMenu.ts — reusable context-menu / dropdown component
//
// Shows a positioned overlay with menu items, optional keybinding labels,
// group separators, keyboard navigation, and click-outside-to-dismiss.
// Follows VS Code's ContextMenuHandler / Menu pattern adapted for Parallx.
//
// VS Code reference:
//   - src/vs/platform/contextview/browser/contextMenuHandler.ts
//   - src/vs/base/browser/ui/menu/menu.ts
//   - src/vs/base/browser/ui/contextview/contextview.ts

import { Disposable, toDisposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single menu entry. */
export interface IContextMenuItem {
  /** Unique identifier for this item (e.g. command ID). */
  readonly id: string;
  /** Display label shown in the menu. */
  readonly label: string;
  /** Optional keybinding display string (e.g. "Ctrl+B"). */
  readonly keybinding?: string;
  /** Optional group key for visual separation. */
  readonly group?: string;
  /** Optional sort order within a group. */
  readonly order?: number;
  /** Whether this item is disabled (grayed out, not clickable). */
  readonly disabled?: boolean;
}

/** Anchor specification for positioning the menu. */
export interface IContextMenuAnchor {
  readonly x: number;
  readonly y: number;
}

/** Options for the context menu. */
export interface IContextMenuOptions {
  /** Items to show. */
  readonly items: readonly IContextMenuItem[];
  /** Where to position the menu. */
  readonly anchor: IContextMenuAnchor;
  /** Whether to auto-select the first item. Default false. */
  readonly autoSelectFirst?: boolean;
  /** Additional CSS class(es) for the root element. */
  readonly className?: string;
}

/** Fired when an item is selected. */
export interface IContextMenuSelectEvent {
  readonly item: IContextMenuItem;
}

// ─── ContextMenu ─────────────────────────────────────────────────────────────

/**
 * A floating menu positioned at an anchor point.
 *
 * Usage:
 * ```ts
 * const ctxMenu = ContextMenu.show({
 *   items: [{ id: 'copy', label: 'Copy', keybinding: 'Ctrl+C' }],
 *   anchor: { x: event.clientX, y: event.clientY },
 * });
 * ctxMenu.onDidSelect(e => console.log('selected', e.item.id));
 * // ctxMenu auto-disposes when dismissed, or call ctxMenu.dispose() manually.
 * ```
 */
export class ContextMenu extends Disposable {

  // ── Events ──

  private readonly _onDidSelect = this._register(new Emitter<IContextMenuSelectEvent>());
  readonly onDidSelect: Event<IContextMenuSelectEvent> = this._onDidSelect.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  // ── DOM ──

  private readonly _el: HTMLElement;
  private readonly _itemEls: HTMLElement[] = [];
  private _highlightIndex = -1;

  // ── Lifecycle ──

  private _dismissed = false;

  private constructor(private readonly _options: IContextMenuOptions) {
    super();

    // Build root element
    this._el = document.createElement('div');
    this._el.classList.add('context-menu');
    if (_options.className) {
      this._el.classList.add(_options.className);
    }
    this._el.setAttribute('role', 'menu');

    // Render items
    this._renderItems(_options.items);

    // Position (computed layout — allowed inline)
    this._el.style.left = `${_options.anchor.x}px`;
    this._el.style.top = `${_options.anchor.y}px`;

    // Mount
    document.body.appendChild(this._el);

    // Adjust position if overflowing viewport
    this._clampToViewport();

    // Auto-select first if requested
    if (_options.autoSelectFirst && this._itemEls.length > 0) {
      this._highlight(0);
    }

    // Keyboard navigation
    this._register(this._listenKeyboard());

    // Click outside to dismiss
    this._register(this._listenOutsideClick());

    // Clean up DOM on dispose
    this._register(toDisposable(() => {
      if (this._el.parentNode) this._el.remove();
    }));
  }

  /** Static factory — creates and returns a new ContextMenu. */
  static show(options: IContextMenuOptions): ContextMenu {
    return new ContextMenu(options);
  }

  /** Programmatically dismiss the menu. */
  dismiss(): void {
    if (this._dismissed) return;
    this._dismissed = true;
    this._onDidDismiss.fire();
    this.dispose();
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  private _renderItems(items: readonly IContextMenuItem[]): void {
    let lastGroup: string | undefined;

    for (const item of items) {
      // Group separator
      if (lastGroup !== undefined && item.group !== lastGroup) {
        const sep = document.createElement('div');
        sep.classList.add('context-menu-separator');
        sep.setAttribute('role', 'separator');
        this._el.appendChild(sep);
      }
      lastGroup = item.group;

      const row = document.createElement('div');
      row.classList.add('context-menu-item');
      if (item.disabled) {
        row.classList.add('context-menu-item--disabled');
      }
      row.setAttribute('role', 'menuitem');

      // Label
      const label = document.createElement('span');
      label.classList.add('context-menu-item-label');
      label.textContent = item.label;
      row.appendChild(label);

      // Keybinding
      if (item.keybinding) {
        const kb = document.createElement('span');
        kb.classList.add('context-menu-item-keybinding');
        kb.textContent = item.keybinding;
        row.appendChild(kb);
      }

      // Click
      if (!item.disabled) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this._select(item);
        });
      }

      // Hover highlight
      row.addEventListener('mouseenter', () => {
        if (!item.disabled) {
          this._highlight(this._itemEls.indexOf(row));
        }
      });

      this._itemEls.push(row);
      this._el.appendChild(row);
    }
  }

  // ── Highlight / selection ──────────────────────────────────────────────

  private _highlight(index: number): void {
    for (let i = 0; i < this._itemEls.length; i++) {
      this._itemEls[i].classList.toggle('context-menu-item--selected', i === index);
    }
    this._highlightIndex = index;
    this._itemEls[index]?.scrollIntoView({ block: 'nearest' });
  }

  private _select(item: IContextMenuItem): void {
    this._onDidSelect.fire({ item });
    this.dismiss();
  }

  // ── Keyboard ───────────────────────────────────────────────────────────

  private _listenKeyboard(): IDisposable {
    const enabledIndices = this._getEnabledIndices();

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = this._nextEnabled(this._highlightIndex, 1, enabledIndices);
          if (next >= 0) this._highlight(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = this._nextEnabled(this._highlightIndex, -1, enabledIndices);
          if (prev >= 0) this._highlight(prev);
          break;
        }
        case 'Home': {
          e.preventDefault();
          if (enabledIndices.length) this._highlight(enabledIndices[0]);
          break;
        }
        case 'End': {
          e.preventDefault();
          if (enabledIndices.length) this._highlight(enabledIndices[enabledIndices.length - 1]);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const items = this._options.items.filter(i => !i.disabled);
          const enabledIndexPos = enabledIndices.indexOf(this._highlightIndex);
          if (enabledIndexPos >= 0 && enabledIndexPos < items.length) {
            this._select(items[enabledIndexPos]);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          this.dismiss();
          break;
        }
      }
    };

    document.addEventListener('keydown', handler, true);
    return toDisposable(() => document.removeEventListener('keydown', handler, true));
  }

  private _getEnabledIndices(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this._itemEls.length; i++) {
      if (!this._itemEls[i].classList.contains('context-menu-item--disabled')) {
        result.push(i);
      }
    }
    return result;
  }

  private _nextEnabled(from: number, direction: 1 | -1, enabled: number[]): number {
    if (enabled.length === 0) return -1;
    const currentPos = enabled.indexOf(from);
    if (currentPos < 0) {
      return direction === 1 ? enabled[0] : enabled[enabled.length - 1];
    }
    const nextPos = currentPos + direction;
    if (nextPos < 0 || nextPos >= enabled.length) return from;
    return enabled[nextPos];
  }

  // ── Outside click ──────────────────────────────────────────────────────

  private _listenOutsideClick(): IDisposable {
    const handler = (e: MouseEvent) => {
      if (!this._el.contains(e.target as Node)) {
        this.dismiss();
      }
    };
    // Defer to avoid catching the click that opened the menu
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handler, true);
    }, 0);

    return toDisposable(() => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handler, true);
    });
  }

  // ── Viewport clamping ──────────────────────────────────────────────────

  private _clampToViewport(): void {
    const rect = this._el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.right > vw) {
      this._el.style.left = `${Math.max(0, vw - rect.width)}px`;
    }
    if (rect.bottom > vh) {
      this._el.style.top = `${Math.max(0, vh - rect.height)}px`;
    }
  }
}
