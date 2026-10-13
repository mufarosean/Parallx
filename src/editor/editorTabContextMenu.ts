// editorTabContextMenu.ts — the menu on an editor tab: close this one,
// the others, those to the right, the saved ones or all; move it to the
// group before or after (the keyboard's way for a tab drag); copy the path;
// reveal in the explorer. The group view hands it its model and two
// callbacks and nothing else.

import { ContextMenu, type IContextMenuItem } from '../ui/contextMenu.js';
import type { URI } from '../platform/uri.js';
import type { IEditorInput } from './editorInput.js';
import type { EditorGroupModel } from './editorGroupModel.js';

export interface IEditorTabMenuHost {
  readonly model: Pick<EditorGroupModel, 'editors' | 'count' | 'closeEditor' | 'closeOthers' | 'closeToTheRight' | 'closeSaved' | 'closeAllEditors'>;
  relativePathOf(uri: URI): string;
  revealInExplorer(uri: URI): void;
  /** Whether a group sits before and after this one. */
  neighbors?(): { previous: boolean; next: boolean };
  /** Move the editor to the group before or after; after with none splits one off. */
  moveToGroup?(editor: IEditorInput, where: 'previous' | 'next'): void;
}

export function showEditorTabContextMenu(host: IEditorTabMenuHost, editor: IEditorInput, e: MouseEvent): void {
  const currentIdx = host.model.editors.indexOf(editor);
  if (currentIdx < 0) return;

  const editorCount = host.model.count;
  const isLast = currentIdx === editorCount - 1;
  const uri: URI | undefined = editor.uri;

  // ── Build menu items ──
  const items: IContextMenuItem[] = [];

  // Group 1: Close operations
  items.push({ id: 'close', label: 'Close', keybinding: 'Ctrl+W', group: '1_close', order: 10 });
  items.push({
    id: 'closeOthers', label: 'Close Others', group: '1_close', order: 20,
    disabled: editorCount <= 1,
  });
  items.push({
    id: 'closeRight', label: 'Close to the Right', group: '1_close', order: 30,
    disabled: isLast,
  });
  items.push({ id: 'closeSaved', label: 'Close Saved', group: '1_close', order: 40 });
  items.push({ id: 'closeAll', label: 'Close All', group: '1_close', order: 50 });

  // Group 2: Move to another group (a tab drag, from the keyboard)
  if (host.moveToGroup && host.neighbors) {
    const around = host.neighbors();
    items.push({ id: 'moveToPreviousGroup', label: 'Move to Previous Group', group: '2_move', order: 10, disabled: !around.previous });
    items.push({ id: 'moveToNextGroup', label: 'Move to Next Group', group: '2_move', order: 20, disabled: !around.next && editorCount <= 1 });
  }

  // Group 6: Path operations (only when editor has a URI)
  if (uri) {
    items.push({ id: 'copyPath', label: 'Copy Path', group: '6_path', order: 10 });
    items.push({ id: 'copyRelativePath', label: 'Copy Relative Path', group: '6_path', order: 20 });
  }

  // Group 7: Reveal (only when editor has a URI)
  if (uri) {
    items.push({ id: 'revealInExplorer', label: 'Reveal in Explorer', group: '7_reveal', order: 10 });
  }

  // ── Show menu ──
  const menu = ContextMenu.show({
    items,
    anchor: { x: e.clientX, y: e.clientY },
  });

  // ── Handle selection ──
  menu.onDidSelect(({ item }) => {
    // Re-resolve index in case model changed between show and click
    const idx = host.model.editors.indexOf(editor);
    if (idx < 0 && item.id !== 'closeAll' && item.id !== 'closeSaved') return;

    switch (item.id) {
      case 'close':
        host.model.closeEditor(idx);
        break;
      case 'closeOthers':
        host.model.closeOthers(idx);
        break;
      case 'closeRight':
        host.model.closeToTheRight(idx);
        break;
      case 'closeSaved':
        host.model.closeSaved();
        break;
      case 'closeAll':
        host.model.closeAllEditors();
        break;
      case 'moveToPreviousGroup':
        host.moveToGroup?.(editor, 'previous');
        break;
      case 'moveToNextGroup':
        host.moveToGroup?.(editor, 'next');
        break;
      case 'copyPath':
        if (uri) {
          navigator.clipboard.writeText(uri.fsPath).catch(() => {});
        }
        break;
      case 'copyRelativePath':
        if (uri) {
          const relativePath = host.relativePathOf(uri);
          navigator.clipboard.writeText(relativePath).catch(() => {});
        }
        break;
      case 'revealInExplorer':
        if (uri) {
          host.revealInExplorer(uri);
        }
        break;
    }
  });
}

/** The path relative to the first workspace folder that holds it, else the full path. */
export function workspaceRelativePath(uri: URI, folders: readonly { uri: URI }[]): string {
  const fsPath = uri.fsPath;
  for (const folder of folders) {
    const folderPath = folder.uri.fsPath;
    if (fsPath.startsWith(folderPath)) {
      let relative = fsPath.substring(folderPath.length);
      if (relative.startsWith('/') || relative.startsWith('\\')) relative = relative.substring(1);
      return relative;
    }
  }
  return fsPath;
}
