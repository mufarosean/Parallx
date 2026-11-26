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
import { SECTION_BOX_PREFIX, SECTION_NAMES } from './columnSections.js';
import { CONTAINER_DRAG_TYPE, type ContainerDragData } from '../platform/dragTypes.js';

/** Opens a section's menu (Move Up, Move Down, Restore Default Places); what each section's three dots run. */
export const SECTION_MENU_COMMAND = 'workbench.action.sidebarSectionMenu';
/** Every section of the column back in its default place. */
export const RESET_SECTIONS_COMMAND = 'workbench.action.resetSidebarSections';
/** Marks a drag as a section's, so the sidebar can tell it from a tool's while it is over it. */
export const SECTION_DRAG_TYPE = 'application/x-parallx-column-section';

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
 * Each section of the column (the tools, Open, the two rows at the foot) is
 * moved by taking hold of it: dragged from its own top, or from anywhere in
 * it that is not itself something to drag. Dropped elsewhere in the sidebar
 * it takes that place; dropped outside, it becomes a box of its own there,
 * as a tool's list does, and docking that box brings it back. The three
 * dots that show at a section's top right while it is pointed at, focused in
 * or touched do the same from a menu, which is how the keys do it. The open
 * tool's list is the sidebar's own: its name strip moves the whole sidebar.
 * Nothing can be closed; Restore Default Places puts every section back.
 */
function seatSectionMoves(sidebar: SidebarPart, services: ServiceCollection, requestSave: () => void, store: DisposableStore): void {
  const movable = ['tools', 'open', 'foot'] as const;
  const boxId = (section: ColumnSection): string => `${SECTION_BOX_PREFIX}${section}`;
  const run = (id: string, ...args: unknown[]): void => {
    if (services.has(ICommandService)) void services.get(ICommandService).executeCommand(id, ...args);
  };
  const dots = new Map<ColumnSection, HTMLElement>();
  for (const section of movable) {
    const host = sidebar.sectionElements(section)[0];
    if (!host) continue;
    host.draggable = true;
    host.dataset.section = section;
    const more = createIconButton(null, { id: `column.section.${section}.more`, icon: 'ellipsis', title: `${SECTION_NAMES[section]}: Move…`, size: 'sm', command: SECTION_MENU_COMMAND, args: [section] });
    more.classList.add('column-section-more');
    // First in the section, so the keys reach its three dots before what it holds.
    host.prepend(more);
    dots.set(section, more);
  }

  // The drag. A section carries the same payload a tool's list does, so the
  // layout offers it the same places outside the sidebar; inside the sidebar
  // the drop is a new place in the order, marked by a line.
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
    // Only a drag that starts on the section itself: a tool's row inside it is its own drag.
    const origin = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[draggable="true"]') : null;
    const section = origin?.dataset.section as ColumnSection | undefined;
    if (!origin || !section || !movable.includes(section as typeof movable[number]) || !e.dataTransfer) return;
    dragged = section;
    e.dataTransfer.setData(SECTION_DRAG_TYPE, section);
    e.dataTransfer.setData(CONTAINER_DRAG_TYPE, JSON.stringify({ containerId: boxId(section) } satisfies ContainerDragData));
    e.dataTransfer.effectAllowed = 'move';
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
  // The sections' own elements hear the start wherever they are (in the sidebar or in a box).
  const hosts = movable.map((section) => sidebar.sectionElements(section)[0]).filter((el): el is HTMLElement => !!el);
  for (const host of hosts) host.addEventListener('dragstart', onDragStart);
  column.addEventListener('dragover', onDragOver);
  column.addEventListener('drop', onDrop);
  document.addEventListener('dragend', onDragEnd);
  store.add({ dispose: () => {
    for (const host of hosts) { host.removeEventListener('dragstart', onDragStart); host.draggable = false; }
    column.removeEventListener('dragover', onDragOver);
    column.removeEventListener('drop', onDrop);
    document.removeEventListener('dragend', onDragEnd);
  } });

  if (!services.has(ICommandService)) return;
  const commands = services.get(ICommandService) as unknown as CommandService;
  const restore = (): void => {
    for (const section of movable) if (!sidebar.hasSection(section)) run('workbench.action.container.dock', boxId(section), 'left');
    sidebar.resetSections();
    requestSave();
  };
  store.add(commands.registerCommand({
    id: SECTION_MENU_COMMAND,
    title: 'Move a Sidebar Section…',
    category: 'View',
    handler: (_ctx, which?: unknown) => {
      const section = movable.find((id) => id === which) ?? 'tools';
      const anchor = dots.get(section) ?? sidebar.element;
      const here = sidebar.hasSection(section);
      const at = sidebar.sectionOrder.indexOf(section);
      const out = (edge: 'left' | 'right' | 'bottom') => (): void => { run('workbench.action.container.float', boxId(section)); run('workbench.action.container.moveToEdge', boxId(section), edge); };
      const atDefault = sidebar.sectionOrder.join() === DEFAULT_SECTION_ORDER.join() && movable.every((id) => sidebar.hasSection(id));
      createMenu(anchor, { id: 'column.section.menu', label: `${SECTION_NAMES[section]}: Move`, items: [
        ...(here ? [
          { label: 'Move Up', icon: 'arrow-up', disabled: at <= 0, onSelect: () => { sidebar.moveSection(section, -1); requestSave(); } },
          { label: 'Move Down', icon: 'arrow-down', disabled: at >= sidebar.sectionOrder.length - 1, onSelect: () => { sidebar.moveSection(section, 1); requestSave(); } },
        ] : [
          { label: 'Return To Sidebar', icon: 'panel-left', onSelect: () => run('workbench.action.container.dock', boxId(section), 'left') },
        ]),
        { separator: true },
        { label: 'Move To Left Edge', onSelect: out('left') },
        { label: 'Move To Right Edge', onSelect: out('right') },
        { label: 'Move To Bottom Edge', onSelect: out('bottom') },
        { separator: true },
        { label: 'Restore Default Places', icon: 'rotate-ccw', disabled: atDefault, onSelect: restore },
      ] });
    },
  }));
  store.add(commands.registerCommand({
    id: RESET_SECTIONS_COMMAND,
    title: 'Restore Sidebar Sections',
    category: 'View',
    handler: restore,
  }));
}
