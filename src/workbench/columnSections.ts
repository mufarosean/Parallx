// columnSections.ts — a section of the column as a box of its own
//
// The tools, Open and the two rows at the foot each sit in the primary
// sidebar, and each can leave it: dragged out, it becomes a box in the
// workbench grid like a tool's own box, through the same pipeline
// (containerBox.ts), under the id `section:<name>`. Docking it anywhere
// returns it to the sidebar, in the place it holds there.

import { Emitter } from '../platform/events.js';
import { ViewContainer } from '../views/viewContainer.js';
import type { IView } from '../views/viewTypes.js';
import type { ColumnSection, SidebarPart } from '../parts/sidebarPart.js';

export const SECTION_BOX_PREFIX = 'section:';
/** What a section is called on its box and in its menu. */
export const SECTION_NAMES: Record<ColumnSection, string> = { tools: 'Tools', open: 'Open', view: 'Tool List', foot: 'Settings' };

const sectionOf = (boxId: string): ColumnSection | undefined => {
  const name = boxId.slice(SECTION_BOX_PREFIX.length);
  return name === 'tools' || name === 'open' || name === 'foot' ? name : undefined;
};

/** The section's element as a view, so a view container (and so a box) can hold it. */
function sectionView(section: ColumnSection, element: HTMLElement): IView {
  const constraints = new Emitter<void>();
  const visibility = new Emitter<boolean>();
  return {
    id: `section.${section}`,
    name: SECTION_NAMES[section],
    element,
    minimumWidth: 170, maximumWidth: Number.POSITIVE_INFINITY, minimumHeight: 60, maximumHeight: Number.POSITIVE_INFINITY,
    createElement: (container) => { container.appendChild(element); },
    setVisible: () => { /* shown while its box is */ },
    layout: () => { /* fills its box */ },
    focus: () => { element.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus(); },
    saveState: () => ({}),
    restoreState: () => { /* nothing of its own */ },
    onDidChangeConstraints: constraints.event,
    onDidChangeVisibility: visibility.event,
    dispose: () => { constraints.dispose(); visibility.dispose(); },
  };
}

/** Take a section out of the sidebar for a box. Undefined when it is not there to take. */
export function undockSection(sidebar: SidebarPart, boxId: string): { vc: ViewContainer; label: string } | undefined {
  const section = sectionOf(boxId);
  const element = section ? sidebar.takeSection(section) : undefined;
  if (!section || !element) return undefined;
  const vc = new ViewContainer(`section.${section}`);
  vc.hideTabBar();
  vc.addView(sectionView(section, element));
  return { vc, label: SECTION_NAMES[section] };
}

/** Return a section to the sidebar; the wrapper that held it in its box goes. */
export function dockSection(sidebar: SidebarPart, boxId: string, vc: ViewContainer): void {
  const section = sectionOf(boxId);
  if (section) sidebar.returnSection(section);
  vc.dispose();
}
