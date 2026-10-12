// viewTabVisibilityMenu.ts — the menu on a view container's tab strip: one
// row per view with a tick on the visible ones; a click hides or shows
// that view, never the last visible one.

import { ContextMenu, type IContextMenuItem } from '../ui/contextMenu.js';

export interface IViewTabVisibilityHost {
  readonly tabOrder: readonly string[];
  isHidden(viewId: string): boolean;
  nameOf(viewId: string): string;
  setTabHidden(viewId: string, hidden: boolean): void;
}

export function showTabVisibilityMenu(host: IViewTabVisibilityHost, x: number, y: number): void {
  // Build items: one row per registered view with a checkmark for visible ones
  const items: IContextMenuItem[] = host.tabOrder.map(viewId => {
    const isVisible = !host.isHidden(viewId);
    return {
      id: viewId,
      label: host.nameOf(viewId),
      renderIcon: isVisible
        ? (container: HTMLElement) => { container.textContent = '✓'; container.style.width = '16px'; }
        : (container: HTMLElement) => { container.style.width = '16px'; },
    };
  });

  const menu = ContextMenu.show({
    items,
    anchor: { x, y },
  });

  menu.onDidSelect(({ item }) => {
    const isCurrentlyHidden = host.isHidden(item.id);

    // Don't allow hiding the last visible tab
    if (!isCurrentlyHidden) {
      const visibleCount = host.tabOrder.filter(id => !host.isHidden(id)).length;
      if (visibleCount <= 1) return; // must keep at least one visible
    }

    host.setTabHidden(item.id, !isCurrentlyHidden);
  });
}
