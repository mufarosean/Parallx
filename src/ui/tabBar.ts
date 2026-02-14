// tabBar.ts — TabBar UI component
//
// A generic tab strip that renders a horizontal row of tabs with
// active state, close buttons, dirty/sticky decorations, and
// drag-and-drop reordering. Context-agnostic — works for editor
// tabs, view container tabs, or any tabbed interface.
//
// VS Code reference: `src/vs/workbench/browser/parts/editor/editorTabsControl.ts`

import { Disposable, DisposableStore } from '../platform/lifecycle.js';
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
}

export interface TabReorderEvent {
  readonly fromId: string;
  readonly toId: string;
}

// ─── TabBar ──────────────────────────────────────────────────────────────────

/**
 * A horizontal tab strip.
 *
 * CSS classes:
 * - `.ui-tab-bar` — the container
 * - `.ui-tab-bar-tabs` — scrollable tabs wrapper
 * - `.ui-tab` — individual tab
 * - `.ui-tab--active` — active tab
 * - `.ui-tab--italic` — preview/italic tab
 * - `.ui-tab--sticky` — pinned (sticky) tab
 * - `.ui-tab-icon` — icon span inside tab
 * - `.ui-tab-label` — label span inside tab
 * - `.ui-tab-dirty` — dirty indicator span
 * - `.ui-tab-close` — close button span
 * - `.ui-tab--dragging` — applied during drag
 * - `.ui-tab--drop-target` — applied during dragover
 */
export class TabBar extends Disposable {

  readonly element: HTMLElement;

  private readonly _tabsWrap: HTMLElement;
  private readonly _tabElements = new Map<string, HTMLElement>();
  private readonly _tabListeners = this._register(new DisposableStore());

  private _items: ITabBarItem[] = [];
  private _activeId: string | undefined;

  private readonly _reorderable: boolean;
  private readonly _dragType: string;

  // ── Events ──

  private readonly _onDidSelect = this._register(new Emitter<string>());
  readonly onDidSelect: Event<string> = this._onDidSelect.event;

  private readonly _onDidClose = this._register(new Emitter<string>());
  readonly onDidClose: Event<string> = this._onDidClose.event;

  private readonly _onDidReorder = this._register(new Emitter<TabReorderEvent>());
  readonly onDidReorder: Event<TabReorderEvent> = this._onDidReorder.event;

  private readonly _onDidDoubleClick = this._register(new Emitter<string>());
  readonly onDidDoubleClick: Event<string> = this._onDidDoubleClick.event;

  constructor(container: HTMLElement, options?: ITabBarOptions) {
    super();

    this._reorderable = options?.reorderable ?? true;
    this._dragType = options?.dragType ?? 'application/x-parallx-tab';

    this.element = $('div.ui-tab-bar');
    this.element.setAttribute('role', 'tablist');

    this._tabsWrap = $('div.ui-tab-bar-tabs');
    this.element.appendChild(this._tabsWrap);

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
  }

  private _createTab(item: ITabBarItem): HTMLElement {
    const tab = $('div.ui-tab');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.dataset.tabId = item.id;

    toggleClass(tab, 'ui-tab--italic', !!item.italic);
    toggleClass(tab, 'ui-tab--sticky', !!item.decorations?.pinned);

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

    // Drag-and-drop
    if (this._reorderable) {
      tab.draggable = true;

      this._tabListeners.add(addDisposableListener(tab, 'dragstart', (e) => {
        e.dataTransfer?.setData(this._dragType, item.id);
        e.dataTransfer!.effectAllowed = 'move';
        tab.classList.add('ui-tab--dragging');
      }));

      this._tabListeners.add(addDisposableListener(tab, 'dragend', () => {
        tab.classList.remove('ui-tab--dragging');
      }));

      this._tabListeners.add(addDisposableListener(tab, 'dragover', (e) => {
        if (e.dataTransfer?.types.includes(this._dragType)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          tab.classList.add('ui-tab--drop-target');
        }
      }));

      this._tabListeners.add(addDisposableListener(tab, 'dragleave', () => {
        tab.classList.remove('ui-tab--drop-target');
      }));

      this._tabListeners.add(addDisposableListener(tab, 'drop', (e) => {
        tab.classList.remove('ui-tab--drop-target');
        const fromId = e.dataTransfer?.getData(this._dragType);
        if (fromId && fromId !== item.id) {
          e.preventDefault();
          this._onDidReorder.fire({ fromId, toId: item.id });
        }
      }));
    }

    return tab;
  }
}
