// columnChrome.ts — what the column holds that is the app's own
//
// Around the tools (which the tools that are on contribute) and the open
// tool's list, the column has three things of its own: a Home row over the
// tools, Open (every editor that is open, whatever tool is showing), and at
// the foot, pinned, where tools are managed and Settings. This seats them in
// the sidebar part's slots. Each row runs a command; none names a tool the
// user can turn off.

import './openEditors.css';
import { DisposableStore, type IDisposable } from '../platform/lifecycle.js';
import type { ServiceCollection } from '../services/serviceCollection.js';
import { ICommandService, IEditorService } from '../services/serviceTypes.js';
import type { CommandService } from '../commands/commandRegistry.js';
import type { SidebarPart } from '../parts/sidebarPart.js';
import { createButton } from '../ui/kit.js';
import { whenClosedPanesSettle } from '../editor/editorPane.js';
import { createOpenEditorsView, type IOpenEditorsHost } from './openEditorsView.js';

/** Folds and unfolds Open; in the palette as View: Fold Open Editors. */
export const TOGGLE_OPEN_COMMAND = 'workbench.action.toggleOpenEditors';

export function seatColumnChrome(sidebar: SidebarPart, services: ServiceCollection, requestSave: () => void): IDisposable {
  const store = new DisposableStore();
  const { toolsSlot, openSlot, openListSlot: list, footSlot } = sidebar;
  if (!toolsSlot || !openSlot || !list || !footSlot) return store;

  // Home, over the tools: the page the mark in the title bar opens.
  const home = createButton(null, { id: 'column.home', label: 'Home', icon: 'home', kind: 'ghost', command: 'home.open' });
  home.classList.add('column-row');
  toolsSlot.prepend(home);

  // Open: its label folds it and carries the count; under it, a row an editor.
  const label = createButton(null, { id: 'column.open', label: 'Open', icon: 'chevron-down', kind: 'ghost', size: 'sm', title: 'Fold or unfold what is open', command: TOGGLE_OPEN_COMMAND });
  label.classList.add('column-open-label');
  openSlot.prepend(label);
  const says = (count: number): void => {
    const folded = openSlot.classList.contains('sidebar-open--folded');
    label.dataset.count = String(count);
    label.setAttribute('aria-expanded', String(!folded));
    label.setAttribute('aria-label', `Open, ${count} ${count === 1 ? 'editor' : 'editors'}`);
  };
  let count = 0;
  if (services.has(IEditorService)) {
    const editors = services.get(IEditorService);
    const host: IOpenEditorsHost = {
      get openEditors() { return editors.getOpenEditors(); },
      onDidChangeOpenEditors: (listener) => editors.onDidChangeOpenEditors(listener),
      focusEditor: (id) => editors.focusEditor(id),
      closeEditor: async (id) => {
        const open = editors.getOpenEditors().find((e) => e.id === id);
        if (!open) return false;
        const closed = await editors.closeEditor({ id } as never, open.groupId, false);
        await whenClosedPanesSettle();
        return closed;
      },
    };
    store.add(createOpenEditorsView(list, host, (n) => { count = n; says(n); }));
  }
  says(count);
  if (services.has(ICommandService)) {
    store.add((services.get(ICommandService) as unknown as CommandService).registerCommand({
      id: TOGGLE_OPEN_COMMAND,
      title: 'Fold Open Editors',
      category: 'View',
      handler: () => {
        openSlot.classList.toggle('sidebar-open--folded');
        says(count);
        requestSave();
      },
    }));
  }

  // Pinned at the foot: where tools are turned on and off, and Settings.
  for (const row of [
    { id: 'column.toolsAndExtensions', label: 'Tools and Extensions', icon: 'blocks', command: 'tools.showInstalled' },
    { id: 'column.settings', label: 'Settings', icon: 'settings', command: 'settings.open' },
  ]) {
    createButton(footSlot, { id: row.id, label: row.label, icon: row.icon, command: row.command, kind: 'ghost' }).classList.add('column-row', 'column-foot-row');
  }
  return store;
}
