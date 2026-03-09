// viewTabBar.ts — Database view tab bar
//
// Wraps the generic src/ui/TabBar component to provide database view
// switching. Maps IDatabaseView[] to ITabBarItem[] and adds a "+" button
// for creating new views. Supports tab reorder, double-click rename,
// and right-click context menu (duplicate, delete).
//
// Dependencies: platform/ (lifecycle, events), ui/ (tabBar, contextMenu, dom),
// databaseTypes (type-only)

import { Disposable } from '../../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../../platform/events.js';
import type { IDatabaseDataService, IDatabaseView, ViewType } from '../databaseRegistry.js';
import { svgIcon } from '../databaseRegistry.js';
import { TabBar, type ITabBarItem } from '../../../../ui/tabBar.js';
import { ContextMenu, type IContextMenuItem } from '../../../../ui/contextMenu.js';
import { $, addDisposableListener } from '../../../../ui/dom.js';
import { showDatabaseTextEntryDialog } from '../databaseRegistry.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const VIEW_TYPE_ICON_IDS: Record<ViewType, string> = {
  table: 'view-table',
  board: 'view-board',
  list: 'view-list',
  gallery: 'view-gallery',
  calendar: 'view-calendar',
  timeline: 'view-timeline',
};

// ─── ViewTabBar ──────────────────────────────────────────────────────────────

export class ViewTabBar extends Disposable {
  private readonly _tabBar: TabBar;
  private readonly _addBtn: HTMLButtonElement;
  private _views: IDatabaseView[] = [];

  // ── Events ──

  private readonly _onDidSelectView = this._register(new Emitter<string>());
  readonly onDidSelectView: Event<string> = this._onDidSelectView.event;

  private readonly _onDidCreateView = this._register(new Emitter<IDatabaseView>());
  readonly onDidCreateView: Event<IDatabaseView> = this._onDidCreateView.event;

  constructor(
    container: HTMLElement,
    private readonly _dataService: IDatabaseDataService,
    private readonly _databaseId: string,
  ) {
    super();

    // Wrap in a container div for database-specific styling
    const wrapper = $('div.db-view-tabs');
    container.appendChild(wrapper);

    this._tabBar = this._register(new TabBar(wrapper, {
      reorderable: true,
      scrollable: true,
      showActions: false,
      dragType: 'application/x-parallx-database-view',
    }));

    this._addBtn = $('button.db-view-add-btn') as HTMLButtonElement;
    this._addBtn.textContent = '+';
    this._addBtn.title = 'Add a new view';
    this._addBtn.setAttribute('aria-label', 'Add a new view');
    this._register(addDisposableListener(this._addBtn, 'click', (e) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._showNewViewMenuAt(new DOMRect(rect.left, rect.bottom, rect.width, 0));
    }));

    // Wire tab selection
    this._register(this._tabBar.onDidSelect(id => {
      this._onDidSelectView.fire(id);
    }));

    // Wire tab reorder
    this._register(this._tabBar.onDidReorder(event => {
      const orderedIds = this._computeReorder(event.fromId, event.targetId, event.position);
      this._dataService.reorderViews(this._databaseId, orderedIds).catch(err => {
        console.error('[ViewTabBar] Reorder failed:', err);
      });
    }));

    // Wire context menu (right-click tab)
    this._register(this._tabBar.onDidContextMenu(event => {
      this._showViewContextMenu(event.id, event.event);
    }));

    // Wire double-click → rename
    this._register(this._tabBar.onDidDoubleClick(id => {
      this._renameView(id);
    }));
  }

  // ─── Public API ──────────────────────────────────────────────────────

  setViews(views: IDatabaseView[]): void {
    this._views = views;
    const items: ITabBarItem[] = views.map(v => ({
      id: v.id,
      label: v.name,
      icon: svgIcon(VIEW_TYPE_ICON_IDS[v.type] ?? 'view-table'),
      closable: false,
      tooltip: `${v.name} (${v.type})`,
    }));
    this._tabBar.setItems(items);
    this._mountAddViewButton();
  }

  setActive(viewId: string): void {
    this._tabBar.setActive(viewId);
  }

  // ─── New View Menu ───────────────────────────────────────────────────

  // ─── New View Menu ─────────────────────────────────────────────────────

  /** Show the "add view" context menu anchored to the given rect. */
  showNewViewMenu(anchor: DOMRect): void {
    this._showNewViewMenuAt(anchor);
  }

  private _showNewViewMenuAt(anchor: DOMRect): void {
    const viewTypes: { type: ViewType; label: string }[] = [
      { type: 'table', label: 'Table' },
      { type: 'board', label: 'Board' },
      { type: 'list', label: 'List' },
      { type: 'gallery', label: 'Gallery' },
      { type: 'calendar', label: 'Calendar' },
      { type: 'timeline', label: 'Timeline' },
    ];

    const items: IContextMenuItem[] = viewTypes.map(vt => ({
      id: vt.type,
      label: vt.label,
      renderIcon: (container: HTMLElement) => {
        container.innerHTML = svgIcon(VIEW_TYPE_ICON_IDS[vt.type]);
      },
    }));

    const menu = ContextMenu.show({
      items,
      anchor,
      anchorPosition: 'below',
    });

    menu.onDidSelect(async ev => {
      try {
        const type = ev.item.id as ViewType;
        const view = await this._dataService.createView(
          this._databaseId,
          `${viewTypes.find(vt => vt.type === type)?.label ?? type}`,
          type,
        );
        this._onDidCreateView.fire(view);
      } catch (err) {
        console.error('[ViewTabBar] Create view failed:', err);
      }
    });
  }

  // ─── View Context Menu ───────────────────────────────────────────────

  private _showViewContextMenu(viewId: string, e: MouseEvent): void {
    e.preventDefault();
    const view = this._views.find(v => v.id === viewId);
    if (!view) return;

    const isLastView = this._views.length <= 1;

    const items: IContextMenuItem[] = [
      {
        id: 'rename',
        label: 'Rename',
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
      },
      { id: '__sep__', label: '', group: 'danger' },
      {
        id: 'delete',
        label: 'Delete',
        disabled: isLastView,
      },
    ];

    const menu = ContextMenu.show({
      items,
      anchor: { x: e.clientX, y: e.clientY },
    });

    menu.onDidSelect(async ev => {
      try {
        switch (ev.item.id) {
          case 'rename':
            await this._renameView(viewId);
            break;
          case 'duplicate': {
            const dup = await this._dataService.duplicateView(viewId);
            this._onDidCreateView.fire(dup);
            break;
          }
          case 'delete':
            if (!isLastView) {
              await this._dataService.deleteView(viewId);
            }
            break;
        }
      } catch (err) {
        console.error('[ViewTabBar] Context menu action failed:', err);
      }
    });
  }

  // ─── Rename ──────────────────────────────────────────────────────────

  private async _renameView(viewId: string): Promise<void> {
    const view = this._views.find(v => v.id === viewId);
    if (!view) return;

    const newName = await showDatabaseTextEntryDialog({
      title: 'Rename view',
      value: view.name,
      placeholder: 'View name',
      confirmLabel: 'Rename',
    });
    if (newName !== undefined && newName !== '' && newName !== view.name) {
      await this._dataService.updateView(viewId, { name: newName }).catch(err => {
        console.error('[ViewTabBar] Rename failed:', err);
      });
    }
  }

  // ─── Reorder Helper ──────────────────────────────────────────────────

  private _computeReorder(fromId: string, targetId: string, position: 'before' | 'after'): string[] {
    const ids = this._views.map(v => v.id).filter(id => id !== fromId);
    const targetIdx = ids.indexOf(targetId);
    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
    ids.splice(insertIdx, 0, fromId);
    return ids;
  }

  private _mountAddViewButton(): void {
    const tabsWrap = this._tabBar.element.querySelector('.ui-tab-bar-tabs');
    if (!tabsWrap) return;
    tabsWrap.appendChild(this._addBtn);
  }
}
