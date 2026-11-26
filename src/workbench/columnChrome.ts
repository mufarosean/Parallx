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
import { DEFAULT_SECTION_ORDER, type ColumnSection, type SidebarPart } from '../parts/sidebarPart.js';
import { createButton, createIconButton, createMenu } from '../ui/kit.js';
import { whenClosedPanesSettle } from '../editor/editorPane.js';
import { createOpenEditorsView, type IOpenEditorsHost } from './openEditorsView.js';

/** Opens a section's menu (Move Up, Move Down, Restore Default Places); what each section's three dots run. */
export const SECTION_MENU_COMMAND = 'workbench.action.sidebarSectionMenu';
/** Every section of the column back in its default place. */
export const RESET_SECTIONS_COMMAND = 'workbench.action.resetSidebarSections';
/** What a section's grip carries while it is dragged. */
const SECTION_DRAG_TYPE = 'application/x-parallx-column-section';
const SECTION_NAMES: Record<ColumnSection, string> = { tools: 'Tools', open: 'Open', view: 'Tool List', foot: 'Settings Rows' };

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
  seatSectionMoves(sidebar, services, requestSave, store);
  return store;
}

/**
 * Each section of the column can be put elsewhere in it: dragged by the grip
 * that shows at its top while it is pointed at, or moved a place up or down
 * from the three dots beside the grip. The open tool's list keeps its own
 * header and moves as the others move round it. The order is the sidebar
 * part's, kept with the workspace's layout; every section stays inside the
 * primary sidebar, so hiding the sidebar hides them all.
 */
function seatSectionMoves(sidebar: SidebarPart, services: ServiceCollection, requestSave: () => void, store: DisposableStore): void {
  const bars = new Map<ColumnSection, HTMLElement>();
  for (const section of ['tools', 'open', 'foot'] as const) {
    const host = sidebar.sectionElements(section)[0];
    if (!host) continue;
    const grip = createIconButton(null, { id: `column.section.${section}.grip`, icon: 'grip-horizontal', title: `Drag to Move ${SECTION_NAMES[section]}`, size: 'sm', command: SECTION_MENU_COMMAND, args: [section] });
    grip.classList.add('column-section-grip');
    grip.draggable = true;
    grip.dataset.section = section;
    grip.tabIndex = -1; // a handle for the pointer; the keys move a section from the three dots
    const more = createIconButton(null, { id: `column.section.${section}.more`, icon: 'ellipsis', title: `${SECTION_NAMES[section]}: Move…`, size: 'sm', command: SECTION_MENU_COMMAND, args: [section] });
    more.classList.add('column-section-more');
    // First in the section, so the keys reach its three dots before what it holds.
    host.prepend(more, grip);
    bars.set(section, more);
  }

  // The drag: a grip carries its section; the section under the pointer shows
  // on which side it would land; the drop places it there.
  const column = sidebar.element;
  let dragged: ColumnSection | undefined;
  const clearMarks = (): void => { for (const el of column.querySelectorAll('.column-drop-before, .column-drop-after')) el.classList.remove('column-drop-before', 'column-drop-after'); };
  const targetAt = (e: DragEvent): { section: ColumnSection; before: boolean } | undefined => {
    const section = sidebar.sectionOf(e.target instanceof Element ? e.target : null);
    if (!section || section === dragged) return undefined;
    const els = sidebar.sectionElements(section);
    const top = els[0].getBoundingClientRect().top;
    const bottom = els[els.length - 1].getBoundingClientRect().bottom;
    return { section, before: e.clientY < (top + bottom) / 2 };
  };
  const onDragStart = (e: DragEvent): void => {
    const grip = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.column-section-grip') : null;
    if (!grip || !e.dataTransfer) return;
    dragged = grip.dataset.section as ColumnSection;
    e.dataTransfer.setData(SECTION_DRAG_TYPE, dragged);
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation(); // not a move of the whole column
  };
  const onDragOver = (e: DragEvent): void => {
    if (!dragged || !e.dataTransfer?.types.includes(SECTION_DRAG_TYPE)) return;
    clearMarks();
    const at = targetAt(e);
    if (!at) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const els = sidebar.sectionElements(at.section);
    (at.before ? els[0] : els[els.length - 1]).classList.add(at.before ? 'column-drop-before' : 'column-drop-after');
  };
  const onDrop = (e: DragEvent): void => {
    if (!dragged) return;
    const at = targetAt(e);
    clearMarks();
    if (!at) return;
    e.preventDefault();
    e.stopPropagation();
    const order = sidebar.sectionOrder;
    sidebar.placeSection(dragged, at.before ? at.section : order[order.indexOf(at.section) + 1]);
    requestSave();
  };
  const onDragEnd = (): void => { dragged = undefined; clearMarks(); };
  column.addEventListener('dragstart', onDragStart);
  column.addEventListener('dragover', onDragOver);
  column.addEventListener('drop', onDrop);
  document.addEventListener('dragend', onDragEnd);
  store.add({ dispose: () => {
    column.removeEventListener('dragstart', onDragStart);
    column.removeEventListener('dragover', onDragOver);
    column.removeEventListener('drop', onDrop);
    document.removeEventListener('dragend', onDragEnd);
  } });

  if (!services.has(ICommandService)) return;
  const commands = services.get(ICommandService) as unknown as CommandService;
  store.add(commands.registerCommand({
    id: SECTION_MENU_COMMAND,
    title: 'Move a Sidebar Section…',
    category: 'View',
    handler: (_ctx, which?: unknown) => {
      const section = DEFAULT_SECTION_ORDER.find((id) => id === which) ?? 'tools';
      const anchor = bars.get(section) ?? sidebar.element;
      const at = sidebar.sectionOrder.indexOf(section);
      createMenu(anchor, { id: 'column.section.menu', label: `${SECTION_NAMES[section]}: Move`, items: [
        { label: 'Move Up', icon: 'arrow-up', disabled: at <= 0, onSelect: () => { sidebar.moveSection(section, -1); requestSave(); } },
        { label: 'Move Down', icon: 'arrow-down', disabled: at >= sidebar.sectionOrder.length - 1, onSelect: () => { sidebar.moveSection(section, 1); requestSave(); } },
        { separator: true },
        { label: 'Restore Default Places', icon: 'rotate-ccw', disabled: sidebar.sectionOrder.join() === DEFAULT_SECTION_ORDER.join(), onSelect: () => { sidebar.resetSections(); requestSave(); } },
      ] });
    },
  }));
  store.add(commands.registerCommand({
    id: RESET_SECTIONS_COMMAND,
    title: 'Restore Sidebar Sections',
    category: 'View',
    handler: () => { sidebar.resetSections(); requestSave(); },
  }));
}
