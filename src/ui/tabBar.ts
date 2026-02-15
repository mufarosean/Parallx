// tabBar.ts — TabBar UI component
//
// A generic tab strip that renders a horizontal row of tabs with
// active state, close buttons, dirty/sticky decorations, drag-and-drop
// reordering (with positional insertion), overflow scroll buttons,
// optional toolbar actions slot, context menu events, and cross-bar
// drop support. Context-agnostic — works for editor tabs, view
// container tabs, or any tabbed interface.
//
// VS Code reference: `src/vs/workbench/browser/parts/editor/editorTabsControl.ts`

import { Disposable, DisposableStore, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, clearNode, addDisposableListener, toggleClass } from './dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ITabBarItem {
  /** Unique identifier for this tab. */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Optional icon text (emoji or codicon placeholder). */
  readonly icon?: string;
  /** Whether the tab shows a close button. Default: true. */
  readonly closable?: boolean;
  /** Render label in italic (e.g. preview tabs). */
  readonly italic?: boolean;
  /** Tooltip text for the tab (shown on hover). */
  readonly tooltip?: string;
  /** Content to prepend when pinned/sticky (e.g. '📌 '). */
  readonly stickyContent?: string;
  /** Decorations rendered alongside the label. */
  readonly decorations?: {
    readonly dirty?: boolean;
    readonly pinned?: boolean;
  };
}

export interface ITabBarOptions {
  /** Enable drag-and-drop tab reordering. Default: true. */
  readonly reorderable?: boolean;
  /** Drag type string used in dataTransfer. Default: 'application/x-parallx-tab'. */
  readonly dragType?: string;
  /** Show scroll chevron buttons when tabs overflow. Default: false. */
  readonly scrollable?: boolean;
  /** Show a trailing actions container. Default: false. */
  readonly showActions?: boolean;
  /**
   * Factory for custom drag-data. When set, the return value is stored
   * in `dragType` instead of the plain tab ID. A secondary key
   * `${dragType}/tab-id` always stores the bare ID so TabBar can
   * distinguish same-bar from cross-bar drops.
   */
  readonly dragDataFactory?: (id: string) => string;
}

export interface TabReorderEvent {
  /** ID of the dragged tab. */
  readonly fromId: string;
  /** ID of the tab that received the drop. */
  readonly targetId: string;
  /** Where the drop landed relative to the target. */
  readonly position: 'before' | 'after';
}

export interface TabContextMenuEvent {
  /** ID of the right-clicked tab. */
  readonly id: string;
  /** Original MouseEvent. */
  readonly event: MouseEvent;
}

export interface TabExternalDropEvent {
  /** The original DragEvent (consumers can read dataTransfer). */
  readonly event: DragEvent;
  /** ID of the tab the drop landed on (undefined if dropped on empty area). */
  readonly targetId?: string;
  /** Position relative to targetId, or 'end' if dropped on empty area. */
  readonly position: 'before' | 'after' | 'end';
}

// ─── TabBar ──────────────────────────────────────────────────────────────────

/**
 * A horizontal tab strip with scroll overflow, DnD, context menus, etc.
 *
 * CSS classes:
 * - `.ui-tab-bar` — the container
 * - `.ui-tab-bar-tabs` — scrollable tabs wrapper
 * - `.ui-tab-bar-scroll-btn` — scroll chevron buttons
 * - `.ui-tab-bar-actions` — trailing actions slot
 * - `.ui-tab` — individual tab
 * - `.ui-tab--active` — active tab
 * - `.ui-tab--italic` — preview/italic tab
 * - `.ui-tab--sticky` — pinned (sticky) tab
 * - `.ui-tab-icon` — icon span inside tab
 * - `.ui-tab-label` — label span inside tab
 * - `.ui-tab-dirty` — dirty indicator span
 * - `.ui-tab-close` — close button span
 * - `.ui-tab--dragging` — applied during drag
 * - `.ui-tab--drop-before` / `.ui-tab--drop-after` — insertion indicators
 */
export class TabBar extends Disposable {

  readonly element: HTMLElement;

  private readonly _scrollLeft: HTMLElement | undefined;
  private readonly _scrollRight: HTMLElement | undefined;
  private readonly _tabsWrap: HTMLElement;
  private readonly _actionsSlot: HTMLElement | undefined;
  private readonly _tabElements = new Map<string, HTMLElement>();
  private readonly _tabListeners = this._register(new DisposableStore());
  private _resizeObserver: ResizeObserver | undefined;

  private _items: ITabBarItem[] = [];
  private _activeId: string | undefined;

  private readonly _reorderable: boolean;
  private readonly _dragType: string;
  private readonly _dragIdType: string;
  private readonly _dragDataFactory?: (id: string) => string;

  // ── Events ──

  private readonly _onDidSelect = this._register(new Emitter<string>());
  readonly onDidSelect: Event<string> = this._onDidSelect.event;

  private readonly _onDidClose = this._register(new Emitter<string>());
  readonly onDidClose: Event<string> = this._onDidClose.event;

  private readonly _onDidReorder = this._register(new Emitter<TabReorderEvent>());
  readonly onDidReorder: Event<TabReorderEvent> = this._onDidReorder.event;

  private readonly _onDidDoubleClick = this._register(new Emitter<string>());
  readonly onDidDoubleClick: Event<string> = this._onDidDoubleClick.event;

  private readonly _onDidMiddleClick = this._register(new Emitter<string>());
  readonly onDidMiddleClick: Event<string> = this._onDidMiddleClick.event;

  private readonly _onDidContextMenu = this._register(new Emitter<TabContextMenuEvent>());
  readonly onDidContextMenu: Event<TabContextMenuEvent> = this._onDidContextMenu.event;

  private readonly _onDidExternalDrop = this._register(new Emitter<TabExternalDropEvent>());
  readonly onDidExternalDrop: Event<TabExternalDropEvent> = this._onDidExternalDrop.event;

  constructor(container: HTMLElement, options?: ITabBarOptions) {
    super();

    this._reorderable = options?.reorderable ?? true;
    this._dragType = options?.dragType ?? 'application/x-parallx-tab';
    this._dragIdType = `${this._dragType}/tab-id`;
    this._dragDataFactory = options?.dragDataFactory;

    this.element = $('div.ui-tab-bar');
    this.element.setAttribute('role', 'tablist');

    // Scroll left button
    if (options?.scrollable) {
      this._scrollLeft = $('button.ui-tab-bar-scroll-btn.ui-tab-bar-scroll-left');
      this._scrollLeft.textContent = '\u2039'; // ‹
      this._scrollLeft.title = 'Scroll Tabs Left';
      this._scrollLeft.classList.add('hidden');
      this.element.appendChild(this._scrollLeft);
      this._register(addDisposableListener(this._scrollLeft, 'click', () => {
        this._tabsWrap.scrollBy({ left: -200, behavior: 'smooth' });
      }));
    }

    // Tabs wrapper
    this._tabsWrap = $('div.ui-tab-bar-tabs');
    this.element.appendChild(this._tabsWrap);
    if (options?.scrollable) {
      this._tabsWrap.style.overflowX = 'hidden';
      this._register(addDisposableListener(this._tabsWrap, 'scroll', () => this._updateScrollButtons()));
    }

    // Scroll right button
    if (options?.scrollable) {
      this._scrollRight = $('button.ui-tab-bar-scroll-btn.ui-tab-bar-scroll-right');
      this._scrollRight.textContent = '\u203A'; // ›
      this._scrollRight.title = 'Scroll Tabs Right';
      this._scrollRight.classList.add('hidden');
      this.element.appendChild(this._scrollRight);
      this._register(addDisposableListener(this._scrollRight, 'click', () => {
        this._tabsWrap.scrollBy({ left: 200, behavior: 'smooth' });
      }));
    }

    // Actions slot
    if (options?.showActions) {
      this._actionsSlot = $('div.ui-tab-bar-actions');
      this.element.appendChild(this._actionsSlot);
    }

    // Empty-bar drop target (for drops on an empty tab bar)
    if (this._reorderable) {
      this._setupEmptyBarDrop();
    }

    // ResizeObserver for scroll button visibility
    if (options?.scrollable && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._updateScrollButtons());
      this._resizeObserver.observe(this._tabsWrap);
      this._register(toDisposable(() => this._resizeObserver?.disconnect()));
    }

    container.appendChild(this.element);
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Replace the full set of tabs. Rebuilds the DOM.
   */
  setItems(items: ITabBarItem[]): void {
    this._items = items;
    this._rebuild();
  }

  /**
   * Set the active tab by ID.
   */
  setActive(id: string): void {
    if (this._activeId === id) return;

    // Deactivate previous
    if (this._activeId) {
      const prev = this._tabElements.get(this._activeId);
      if (prev) {
        prev.classList.remove('ui-tab--active');
        prev.setAttribute('aria-selected', 'false');
      }
    }

    // Activate new
    this._activeId = id;
    const next = this._tabElements.get(id);
    if (next) {
      next.classList.add('ui-tab--active');
      next.setAttribute('aria-selected', 'true');
    }
  }

  /**
   * Get the currently active tab ID.
   */
  getActive(): string | undefined {
    return this._activeId;
  }

  /**
   * Scroll the active tab into view.
   */
  scrollToActive(): void {
    if (!this._activeId) return;
    const el = this._tabElements.get(this._activeId);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        this._updateScrollButtons();
      });
    }
  }

  /**
   * Get the trailing actions container (if `showActions` was set).
   * Consumers can append toolbar buttons here.
   */
  getActionsContainer(): HTMLElement | undefined {
    return this._actionsSlot;
  }

  // ─── Internal: Drop on empty bar ───────────────────────────────────────

  private _setupEmptyBarDrop(): void {
    this._register(addDisposableListener(this._tabsWrap, 'dragover', (e) => {
      if (!e.dataTransfer?.types.includes(this._dragType)) return;
      if (this._items.length > 0) return; // only activate for empty bar
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      this._tabsWrap.classList.add('ui-tab-bar--drop-end');
    }));

    this._register(addDisposableListener(this._tabsWrap, 'dragleave', () => {
      this._tabsWrap.classList.remove('ui-tab-bar--drop-end');
    }));

    this._register(addDisposableListener(this._tabsWrap, 'drop', (e) => {
      this._tabsWrap.classList.remove('ui-tab-bar--drop-end');
      if (this._items.length > 0) return;
      if (!e.dataTransfer?.types.includes(this._dragType)) return;
      e.preventDefault();
      e.stopPropagation();
      // Always an external drop when bar is empty
      this._onDidExternalDrop.fire({ event: e, position: 'end' });
    }));
  }

  // ─── Internal: Scroll buttons ──────────────────────────────────────────

  private _updateScrollButtons(): void {
    if (!this._scrollLeft || !this._scrollRight) return;
    const w = this._tabsWrap;
    const hasOverflow = w.scrollWidth > w.clientWidth;
    const atStart = w.scrollLeft <= 0;
    const atEnd = w.scrollLeft + w.clientWidth >= w.scrollWidth - 1;
    toggleClass(this._scrollLeft, 'hidden', !hasOverflow || atStart);
    toggleClass(this._scrollRight, 'hidden', !hasOverflow || atEnd);
  }

  // ─── Internal: Rebuild ─────────────────────────────────────────────────

  private _rebuild(): void {
    clearNode(this._tabsWrap);
    this._tabElements.clear();
    this._tabListeners.clear();

    for (const item of this._items) {
      const tab = this._createTab(item);
      this._tabElements.set(item.id, tab);
      this._tabsWrap.appendChild(tab);
    }

    // Re-apply active state
    if (this._activeId) {
      const activeTab = this._tabElements.get(this._activeId);
      if (activeTab) {
        activeTab.classList.add('ui-tab--active');
        activeTab.setAttribute('aria-selected', 'true');
      }
    }

    // Update scroll buttons after rebuild
    requestAnimationFrame(() => this._updateScrollButtons());
  }

  private _clearDropIndicators(): void {
    for (const el of this._tabElements.values()) {
      el.classList.remove('ui-tab--drop-before', 'ui-tab--drop-after');
    }
  }

  private _createTab(item: ITabBarItem): HTMLElement {
    const tab = $('div.ui-tab');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.dataset.tabId = item.id;

    if (item.tooltip) tab.title = item.tooltip;

    toggleClass(tab, 'ui-tab--italic', !!item.italic);
    toggleClass(tab, 'ui-tab--sticky', !!item.decorations?.pinned);

    // Sticky content (e.g. pin emoji)
    if (item.stickyContent && item.decorations?.pinned) {
      const stickyEl = $('span.ui-tab-sticky', item.stickyContent);
      tab.appendChild(stickyEl);
    }

    // Icon
    if (item.icon) {
      const iconEl = $('span.ui-tab-icon', item.icon);
      tab.appendChild(iconEl);
    }

    // Label
    const labelEl = $('span.ui-tab-label', item.label);
    tab.appendChild(labelEl);

    // Dirty indicator
    if (item.decorations?.dirty) {
      const dirtyEl = $('span.ui-tab-dirty', '●');
      tab.appendChild(dirtyEl);
    }

    // Close button
    const closable = item.closable ?? true;
    if (closable) {
      const closeEl = $('span.ui-tab-close', '×');
      closeEl.title = 'Close';
      this._tabListeners.add(addDisposableListener(closeEl, 'click', (e) => {
        e.stopPropagation();
        this._onDidClose.fire(item.id);
      }));
      tab.appendChild(closeEl);
    }

    // Click → select
    this._tabListeners.add(addDisposableListener(tab, 'click', () => {
      this._onDidSelect.fire(item.id);
    }));

    // Double-click
    this._tabListeners.add(addDisposableListener(tab, 'dblclick', () => {
      this._onDidDoubleClick.fire(item.id);
    }));

    // Middle-click
    this._tabListeners.add(addDisposableListener(tab, 'auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        this._onDidMiddleClick.fire(item.id);
      }
    }));

    // Context menu
    this._tabListeners.add(addDisposableListener(tab, 'contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._onDidContextMenu.fire({ id: item.id, event: e });
    }));

    // Drag-and-drop
    if (this._reorderable) {
      this._setupTabDnD(tab, item);
    }

    return tab;
  }

  // ─── Internal: Per-tab DnD ─────────────────────────────────────────────

  private _setupTabDnD(tab: HTMLElement, item: ITabBarItem): void {
    tab.draggable = true;

    // Drag start
    this._tabListeners.add(addDisposableListener(tab, 'dragstart', (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;

      // Always store the bare tab ID for same-bar detection
      dt.setData(this._dragIdType, item.id);

      // Store primary drag data (custom or plain ID)
      if (this._dragDataFactory) {
        dt.setData(this._dragType, this._dragDataFactory(item.id));
      } else {
        dt.setData(this._dragType, item.id);
      }

      dt.effectAllowed = 'move';
      tab.classList.add('ui-tab--dragging');

      // Custom drag image
      const ghost = document.createElement('div');
      ghost.classList.add('ui-tab-drag-image');
      ghost.textContent = item.label;
      document.body.appendChild(ghost);
      dt.setDragImage(ghost, 0, 0);
      requestAnimationFrame(() => ghost.remove());
    }));

    // Drag end
    this._tabListeners.add(addDisposableListener(tab, 'dragend', () => {
      tab.classList.remove('ui-tab--dragging');
      this._clearDropIndicators();
    }));

    // Drag over (with left/right half detection)
    this._tabListeners.add(addDisposableListener(tab, 'dragover', (e) => {
      if (!e.dataTransfer?.types.includes(this._dragType)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      this._clearDropIndicators();

      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        tab.classList.add('ui-tab--drop-before');
      } else {
        tab.classList.add('ui-tab--drop-after');
      }

      // Auto-scroll near edges
      const wrap = this._tabsWrap;
      const wrapRect = wrap.getBoundingClientRect();
      const EDGE = 30;
      if (e.clientX - wrapRect.left < EDGE) {
        wrap.scrollLeft -= 3;
      } else if (wrapRect.right - e.clientX < EDGE) {
        wrap.scrollLeft += 3;
      }
    }));

    // Drag leave
    this._tabListeners.add(addDisposableListener(tab, 'dragleave', () => {
      tab.classList.remove('ui-tab--drop-before', 'ui-tab--drop-after');
    }));

    // Drop
    this._tabListeners.add(addDisposableListener(tab, 'drop', (e) => {
      this._clearDropIndicators();
      if (!e.dataTransfer?.types.includes(this._dragType)) return;
      e.preventDefault();
      e.stopPropagation();

      // Determine position
      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const position: 'before' | 'after' = e.clientX < midX ? 'before' : 'after';

      // Check if this is a same-bar drop
      const sourceId = e.dataTransfer.getData(this._dragIdType);
      if (sourceId && this._tabElements.has(sourceId) && sourceId !== item.id) {
        this._onDidReorder.fire({ fromId: sourceId, targetId: item.id, position });
      } else {
        // External drop (from another tab bar or external source)
        this._onDidExternalDrop.fire({ event: e, targetId: item.id, position });
      }
    }));
  }
}
