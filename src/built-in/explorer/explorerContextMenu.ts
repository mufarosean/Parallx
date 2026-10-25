// explorerContextMenu.ts — what the Explorer's right-click menu offers.
// Item ids are the Explorer's command ids; the menu runs them with the row
// it was opened on (or the whole selection, when that row is part of it).

import type { IContextMenuItem } from '../../ui/contextMenu.js';

export interface IExplorerMenuTarget {
  /** null: the empty space below the tree. */
  readonly kind: 'file' | 'folder' | null;
  /** How many rows the menu acts on (more than one: the selection). */
  readonly count: number;
  readonly isRoot: boolean;
  readonly expanded: boolean;
  readonly canPaste: boolean;
  readonly revealLabel: string;
}

export function explorerMenuItems(t: IExplorerMenuTarget): IContextMenuItem[] {
  if (t.kind === null) {
    return [
      { id: 'explorer.newFile', label: 'New File…', group: '1_create' },
      { id: 'explorer.newFolder', label: 'New Folder…', group: '1_create' },
      { id: 'explorer.refresh', label: 'Refresh', group: '2_refresh' },
    ];
  }
  const paste: IContextMenuItem[] = t.canPaste ? [{ id: 'explorer.paste', label: 'Paste', keybinding: 'Ctrl+V', group: '3_clipboard' }] : [];
  const properties: IContextMenuItem = { id: 'explorer.properties', label: 'Properties…', keybinding: 'Alt+Enter', group: '9_properties' };
  if (t.count > 1) {
    // Several rows: only what makes sense for all of them at once.
    return [
      { id: 'explorer.addToChat', label: `Add ${t.count} Items to Chat`, group: '1_open' },
      { id: 'explorer.cut', label: 'Cut', keybinding: 'Ctrl+X', group: '3_clipboard' },
      { id: 'explorer.copy', label: 'Copy', keybinding: 'Ctrl+C', group: '3_clipboard' },
      { id: 'explorer.delete', label: `Delete ${t.count} Items`, keybinding: 'Delete', group: '4_edit' },
      { id: 'explorer.copyPath', label: 'Copy Paths', group: '5_copy' },
      { id: 'explorer.copyRelativePath', label: 'Copy Relative Paths', group: '5_copy' },
      properties,
    ];
  }
  const editable = !t.isRoot;
  return [
    ...(t.kind === 'file'
      ? [{ id: 'explorer.open', label: 'Open', group: '1_open' }, { id: 'explorer.openToSide', label: 'Open to the Side', group: '1_open' }]
      : []),
    { id: 'explorer.addToChat', label: 'Add to Chat', group: '1_open' },
    { id: 'explorer.newFile', label: 'New File…', group: '2_create' },
    { id: 'explorer.newFolder', label: 'New Folder…', group: '2_create' },
    ...(editable ? [{ id: 'explorer.cut', label: 'Cut', keybinding: 'Ctrl+X', group: '3_clipboard' }] : []),
    { id: 'explorer.copy', label: 'Copy', keybinding: 'Ctrl+C', group: '3_clipboard' },
    ...paste,
    ...(editable
      ? [{ id: 'explorer.rename', label: 'Rename', keybinding: 'F2', group: '4_edit' }, { id: 'explorer.delete', label: 'Delete', keybinding: 'Delete', group: '4_edit' }]
      : []),
    { id: 'explorer.copyPath', label: 'Copy Path', group: '5_copy' },
    { id: 'explorer.copyRelativePath', label: 'Copy Relative Path', group: '5_copy' },
    { id: 'explorer.revealInFileExplorer', label: t.revealLabel, group: '6_reveal' },
    ...(t.kind === 'folder' && t.expanded ? [{ id: 'explorer.collapse', label: 'Collapse All', group: '7_collapse' }] : []),
    properties,
  ];
}
