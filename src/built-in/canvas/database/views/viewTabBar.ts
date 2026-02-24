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
import { TabBar, type ITabBarItem } from '../../../../ui/tabBar.js';
import { ContextMenu, type IContextMenuItem } from '../../../../ui/contextMenu.js';
import { $ } from '../../../../ui/dom.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const VIEW_TYPE_ICONS: Record<ViewType, string> = {
  table: '⊞',
  board: '☰',
  list: '≡',
  gallery: '⊟',
  calendar: '📅',
  timeline: '⟿',
};

// ─── ViewTabBar ──────────────────────────────────────────────────────────────

export class ViewTabBar extends Disposable {
  private readonly _tabBar: TabBar;
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
    const wrapper = $('div.database-view-tabs');
    container.appendChild(wrapper);

    this._tabBar = this._register(new TabBar(wrapper, {
      reorderable: true,
      scrollable: true,
      showActions: true,
      dragType: 'application/x-parallx-database-view',
    }));

    // "+" button in the actions slot
    const actionsSlot = this._tabBar.getActionsContainer();
    if (actionsSlot) {
      const addBtn = $('button.database-view-add-btn');
      addBtn.textContent = '+';
      addBtn.title = 'Add a view';
      addBtn.addEventListener('click', (e) => this._showNewViewMenu(e));
      actionsSlot.appendChild(addBtn);
    }

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
      icon: VIEW_TYPE_ICONS[v.type] || '⊞',
      closable: false,
      tooltip: `${v.name} (${v.type})`,
    }));
    this._tabBar.setItems(items);
  }

  setActive(viewId: string): void {
    this._tabBar.setActive(viewId);
  }

  // ─── New View Menu ───────────────────────────────────────────────────

  private _showNewViewMenu(e: MouseEvent): void {
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
      label: `${VIEW_TYPE_ICONS[vt.type]}  ${vt.label}`,
    }));

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const menu = ContextMenu.show({
      items,
      anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0),
      anchorPosition: 'below',
    });

    menu.onDidSelect(async ev => {
      try {
        const type = ev.item.id as ViewType;
        const view = await this._dataService.createView(
          this._databaseId,
          `${viewTypes.find(vt => vt.type === type)?.label ?? type} view`,
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
            this._renameView(viewId);
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

  private _renameView(viewId: string): void {
    const view = this._views.find(v => v.id === viewId);
    if (!view) return;

    // Use prompt for now — inline tab rename is a polish item
    const newName = prompt('Rename view:', view.name);
    if (newName && newName !== view.name) {
      this._dataService.updateView(viewId, { name: newName }).catch(err => {
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
}
