// breadcrumbs.ts — reusable BreadcrumbsWidget component
//
// A horizontal bar of clickable breadcrumb items separated by chevrons.
// Mirrors VS Code's BreadcrumbsWidget (src/vs/base/browser/ui/breadcrumbs/breadcrumbsWidget.ts).
//
// Features:
//  - Horizontal scrolling with thin scrollbar
//  - Focus / selection tracking
//  - Keyboard navigation (left/right arrows)
//  - Item click fires onDidSelectItem
//
// Context-agnostic — knows nothing about files, editors, or outlines.
// Feature code (e.g. BreadcrumbsBar) provides concrete items.

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

// ─── BreadcrumbsItem ─────────────────────────────────────────────────────────

/**
 * A single breadcrumb item. Subclasses implement rendering and equality.
 */
export abstract class BreadcrumbsItem {
  abstract dispose(): void;
  abstract equals(other: BreadcrumbsItem): boolean;
  abstract render(container: HTMLElement): void;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface IBreadcrumbsItemEvent {
  readonly type: 'select' | 'focus';
  readonly item: BreadcrumbsItem;
  readonly node: HTMLElement;
  readonly payload: unknown;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export interface IBreadcrumbsWidgetStyles {
  readonly breadcrumbsBackground: string | undefined;
  readonly breadcrumbsForeground: string | undefined;
  readonly breadcrumbsHoverForeground: string | undefined;
  readonly breadcrumbsFocusForeground: string | undefined;
  readonly breadcrumbsFocusAndSelectionForeground: string | undefined;
}

// ─── BreadcrumbsWidget ───────────────────────────────────────────────────────

/**
 * Reusable breadcrumbs widget.
 *
 * VS Code reference: BreadcrumbsWidget in src/vs/base/browser/ui/breadcrumbs/breadcrumbsWidget.ts
 *
 * DOM structure:
 *   .parallx-breadcrumbs         (scrollable container)
 *     .parallx-breadcrumb-item   (per item, with separator appended)
 */
export class BreadcrumbsWidget extends Disposable {
  private readonly _domNode: HTMLDivElement;
  private readonly _items: BreadcrumbsItem[] = [];
  private readonly _nodes: HTMLDivElement[] = [];

  private _enabled = true;
  private _focusedItemIdx = -1;
  private _selectedItemIdx = -1;

  // ── Events ──

  private readonly _onDidSelectItem = this._register(new Emitter<IBreadcrumbsItemEvent>());
  readonly onDidSelectItem: Event<IBreadcrumbsItemEvent> = this._onDidSelectItem.event;

  private readonly _onDidFocusItem = this._register(new Emitter<IBreadcrumbsItemEvent>());
  readonly onDidFocusItem: Event<IBreadcrumbsItemEvent> = this._onDidFocusItem.event;

  private readonly _onDidChangeFocus = this._register(new Emitter<boolean>());
  readonly onDidChangeFocus: Event<boolean> = this._onDidChangeFocus.event;

  constructor(container: HTMLElement, styles?: IBreadcrumbsWidgetStyles) {
    super();

    this._domNode = document.createElement('div');
    this._domNode.className = 'parallx-breadcrumbs';
    this._domNode.tabIndex = 0;
    this._domNode.setAttribute('role', 'list');

    // Click handler — bubble up from items
    this._register(toDisposable(
      addListener(this._domNode, 'click', (e) => this._onClick(e)),
    ));

    // Keyboard navigation
    this._register(toDisposable(
      addListener(this._domNode, 'keydown', (e) => this._onKeyDown(e)),
    ));

    // Focus tracking
    this._register(toDisposable(
      addListener(this._domNode, 'focusin', () => this._onDidChangeFocus.fire(true)),
    ));
    this._register(toDisposable(
      addListener(this._domNode, 'focusout', () => this._onDidChangeFocus.fire(false)),
    ));

    if (styles) {
      this._applyStyles(styles);
    }

    container.appendChild(this._domNode);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  get domNode(): HTMLElement {
    return this._domNode;
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
    this._domNode.classList.toggle('disabled', !value);
  }

  isDOMFocused(): boolean {
    return this._domNode.contains(document.activeElement);
  }

  domFocus(): void {
    const idx = this._focusedItemIdx >= 0
      ? this._focusedItemIdx
      : this._items.length - 1;
    if (idx >= 0 && idx < this._items.length) {
      this._focus(idx, undefined);
    } else {
      this._domNode.focus();
    }
  }

  // ── Items ──

  getItems(): readonly BreadcrumbsItem[] {
    return this._items;
  }

  setItems(items: BreadcrumbsItem[]): void {
    // Dispose old items
    for (const old of this._items) {
      old.dispose();
    }
    this._items.length = 0;
    this._items.push(...items);

    this._render();
    this._focus(-1, undefined);
  }

  reveal(item: BreadcrumbsItem): void {
    const idx = this._items.indexOf(item);
    if (idx >= 0) this._revealIndex(idx);
  }

  revealLast(): void {
    this._revealIndex(this._items.length - 1);
  }

  // ── Focus ──

  getFocused(): BreadcrumbsItem | undefined {
    return this._items[this._focusedItemIdx];
  }

  setFocused(item: BreadcrumbsItem | undefined, payload?: unknown): void {
    this._focus(item ? this._items.indexOf(item) : -1, payload);
  }

  focusPrev(payload?: unknown): void {
    if (this._focusedItemIdx > 0) {
      this._focus(this._focusedItemIdx - 1, payload);
    }
  }

  focusNext(payload?: unknown): void {
    if (this._focusedItemIdx + 1 < this._items.length) {
      this._focus(this._focusedItemIdx + 1, payload);
    }
  }

  // ── Selection ──

  getSelection(): BreadcrumbsItem | undefined {
    return this._items[this._selectedItemIdx];
  }

  setSelection(item: BreadcrumbsItem | undefined, payload?: unknown): void {
    this._select(item ? this._items.indexOf(item) : -1, payload);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  private _render(): void {
    // Clear existing nodes
    this._domNode.innerHTML = '';
    this._nodes.length = 0;

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      const node = document.createElement('div');
      node.className = 'parallx-breadcrumb-item';
      node.tabIndex = -1;
      node.setAttribute('role', 'listitem');

      try {
        item.render(node);
      } catch (err) {
        node.textContent = '<<RENDER ERROR>>';
        console.error(err);
      }

      // Separator chevron (appended inside the item, before next)
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-separator';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '›'; // VS Code uses codicon-chevronRight
      node.appendChild(sep);

      this._domNode.appendChild(node);
      this._nodes.push(node);
    }
  }

  // ── Focus / Selection internals ────────────────────────────────────────

  private _focus(nth: number, payload: unknown): void {
    this._focusedItemIdx = -1;
    for (let i = 0; i < this._nodes.length; i++) {
      const node = this._nodes[i];
      if (i !== nth) {
        node.classList.remove('focused');
      } else {
        this._focusedItemIdx = i;
        node.classList.add('focused');
        node.focus();
      }
    }
    if (this._focusedItemIdx >= 0) {
      this._onDidFocusItem.fire({
        type: 'focus',
        item: this._items[this._focusedItemIdx],
        node: this._nodes[this._focusedItemIdx],
        payload,
      });
    }
  }

  private _select(nth: number, payload: unknown): void {
    this._selectedItemIdx = -1;
    for (let i = 0; i < this._nodes.length; i++) {
      const node = this._nodes[i];
      if (i !== nth) {
        node.classList.remove('selected');
      } else {
        this._selectedItemIdx = i;
        node.classList.add('selected');
      }
    }
    if (this._selectedItemIdx >= 0) {
      this._onDidSelectItem.fire({
        type: 'select',
        item: this._items[this._selectedItemIdx],
        node: this._nodes[this._selectedItemIdx],
        payload,
      });
    }
  }

  private _revealIndex(nth: number): void {
    if (nth < 0 || nth >= this._nodes.length) return;
    const node = this._nodes[nth];
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ── Event handlers ─────────────────────────────────────────────────────

  private _onClick(e: MouseEvent): void {
    if (!this._enabled) return;

    // Walk up from target to find the breadcrumb item node
    let el: HTMLElement | null = e.target as HTMLElement;
    while (el && el !== this._domNode) {
      if (el.classList.contains('parallx-breadcrumb-item')) {
        const idx = this._nodes.indexOf(el as HTMLDivElement);
        if (idx >= 0) {
          this._focus(idx, e);
          this._select(idx, e);
        }
        return;
      }
      el = el.parentElement;
    }
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (!this._enabled) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.focusPrev();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.focusNext();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this._focusedItemIdx >= 0) {
          this._select(this._focusedItemIdx, e);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.setFocused(undefined);
        this.setSelection(undefined);
        this._domNode.blur();
        break;
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────

  private _applyStyles(styles: IBreadcrumbsWidgetStyles): void {
    if (styles.breadcrumbsBackground) {
      this._domNode.style.backgroundColor = styles.breadcrumbsBackground;
    }
    // Foreground colors are handled via CSS custom properties or direct style manipulation
    // For simplicity, we rely on CSS variables from the theme
  }

  // ── Dispose ────────────────────────────────────────────────────────────

  override dispose(): void {
    for (const item of this._items) {
      item.dispose();
    }
    this._items.length = 0;
    this._nodes.length = 0;
    this._domNode.remove();
    super.dispose();
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────

function addListener<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  type: K,
  listener: (e: HTMLElementEventMap[K]) => void,
): () => void {
  el.addEventListener(type, listener);
  return () => el.removeEventListener(type, listener);
}
