// ribbonMenu.ts — right-click on a ribbon (either activity bar): hide this
// icon, or choose which to show. Thirteen unlabeled icons with no way to put
// any away was the busiest edge of the window; this is VS Code's and
// Obsidian's answer. What is hidden is saved with the workspace
// (ActivityBarPart), so it never reaches another workspace.

import type { IDisposable } from '../platform/lifecycle.js';
import type { ActivityBarPart } from '../parts/activityBarPart.js';
import { ContextMenu, type IContextMenuItem } from '../ui/contextMenu.js';

/** Wire the menu on one ribbon; icons whose id starts with `skipPrefix` (parts) are not offered. */
export function wireRibbonMenu(bar: ActivityBarPart, skipPrefix: string): IDisposable {
  return bar.onDidContextMenuIcon(({ iconId, x, y }) => {
    const icons = bar.getIcons().filter((d) => !d.id.startsWith(skipPrefix));
    const label = icons.find((d) => d.id === iconId)?.label ?? 'This Icon';
    const visible = icons.filter((d) => !bar.isIconHidden(d.id));
    const items: IContextMenuItem[] = [
      { id: `hide:${iconId}`, label: `Hide ‘${label}’`, group: '1_hide', disabled: visible.length <= 1 },
      ...icons.map((d) => ({ id: `toggle:${d.id}`, label: d.label, group: '2_icons', checked: !bar.isIconHidden(d.id) })),
      { id: 'show-all', label: 'Show All', group: '3_reset', disabled: visible.length === icons.length },
    ];
    const menu = ContextMenu.show({ items, anchor: { x, y } });
    menu.onDidSelect(({ item }) => {
      if (item.id === 'show-all') { for (const d of icons) bar.setIconHidden(d.id, false); return; }
      const [kind, id] = [item.id.slice(0, item.id.indexOf(':')), item.id.slice(item.id.indexOf(':') + 1)];
      if (kind === 'hide') { bar.setIconHidden(id, true); return; }
      if (kind === 'toggle') {
        const hide = !bar.isIconHidden(id);
        if (hide && visible.length <= 1) return; // always keep one
        bar.setIconHidden(id, hide);
      }
    });
  });
}
