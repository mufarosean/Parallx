/**
 * Phase A — containers are citizens, rails are stacks.
 *
 * Pins the rail mechanics end to end: a container moved to the other rail
 * travels WITH its icon and its DOM, active-state bookkeeping heals on both
 * sides, a built-in returns to its builtin map on the way back, and rail
 * placements survive as pending assignments for containers that arrive
 * after restore. Plus the ribbon itself: an icon drag carries the container
 * payload, and a foreign icon dropped on a ribbon reports the dock request.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  WorkbenchContributionHandler,
  type ContributionHandlerHost,
} from '../../src/workbench/workbenchContributionHandler';
import { ActivityBarPart } from '../../src/parts/activityBarPart';
import { ViewContainer } from '../../src/views/viewContainer';
import { ViewManager } from '../../src/views/viewManager';
import { ViewContributionProcessor } from '../../src/contributions/viewContribution';
import { PartId, PartPosition } from '../../src/parts/partTypes';
import { CONTAINER_DRAG_TYPE } from '../../src/platform/dragTypes';
import type { Part } from '../../src/parts/part';

// ── Fakes ───────────────────────────────────────────────────────────────────

interface FakeBar {
  icons: string[];
  active: string | undefined;
  addIcon(d: { id: string }): { dispose(): void };
  removeIcon(id: string): void;
  setActiveIcon(id: string | undefined): void;
  getIcons(): { id: string }[];
}

function fakeBar(): FakeBar {
  const bar: FakeBar = {
    icons: [],
    active: undefined,
    addIcon(d) {
      if (!bar.icons.includes(d.id)) bar.icons.push(d.id);
      return { dispose: () => bar.removeIcon(d.id) };
    },
    removeIcon(id) { bar.icons = bar.icons.filter((i) => i !== id); },
    setActiveIcon(id) { bar.active = id; },
    getIcons() { return bar.icons.map((id) => ({ id })); },
  };
  return bar;
}

function fakeRailPart(withContainerSlot = false): Part & { viewContainerSlot?: HTMLElement } {
  const element = document.createElement('div');
  const part = {
    element,
    visible: true,
    setVisible(v: boolean) { (part as { visible: boolean }).visible = v; },
  } as unknown as Part & { viewContainerSlot?: HTMLElement };
  if (withContainerSlot) {
    const slot = document.createElement('div');
    element.appendChild(slot);
    (part as { viewContainerSlot?: HTMLElement }).viewContainerSlot = slot;
  }
  return part;
}

describe('container rails', () => {
  let handler: WorkbenchContributionHandler;
  let leftBar: FakeBar;
  let rightBar: FakeBar;
  let sidebar: ReturnType<typeof fakeRailPart>;
  let aux: ReturnType<typeof fakeRailPart>;
  let sidebarSlot: HTMLElement;
  let explorer: ViewContainer;
  let toggles: string[];

  beforeEach(() => {
    leftBar = fakeBar();
    rightBar = fakeBar();
    sidebar = fakeRailPart();
    aux = fakeRailPart(true);
    toggles = [];

    const host: ContributionHandlerHost = {
      sidebar,
      panel: fakeRailPart(),
      auxiliaryBar: aux,
      activityBarPart: leftBar as never,
      rightActivityBar: rightBar as never,
      toggleSidebar: () => toggles.push('sidebar'),
      togglePanel: () => toggles.push('panel'),
      toggleAuxiliaryBar: () => toggles.push('aux'),
      layoutViewContainers: () => {},
    };
    handler = new WorkbenchContributionHandler(host);

    sidebarSlot = document.createElement('div');
    handler.sidebarViewsSlot = sidebarSlot;

    explorer = new ViewContainer('sidebar.view.explorer');
    explorer.setMode('stacked');
    sidebarSlot.appendChild(explorer.element);
    handler.registerBuiltinSidebarContainer('view.explorer', explorer);
    handler.registerContainerIcon('view.explorer', {
      id: 'view.explorer', icon: 'E', label: 'Explorer', source: 'builtin',
    });
    leftBar.addIcon({ id: 'view.explorer' });
    handler.setActiveSidebarContainerId('view.explorer');
  });

  it('moves a container to the right rail with its icon and its DOM', () => {
    expect(handler.railOf('view.explorer')).toBe('left');

    const moved = handler.moveContainerToRail('view.explorer', 'right');

    expect(moved).toBe(true);
    expect(handler.railOf('view.explorer')).toBe('right');
    // The DOM travelled into the right rail's slot…
    expect(explorer.element.parentElement).toBe(aux.viewContainerSlot);
    // …the icon crossed ribbons…
    expect(leftBar.icons).not.toContain('view.explorer');
    expect(rightBar.icons).toContain('view.explorer');
    // …and it is the right rail's shown container.
    expect(rightBar.active).toBe('view.explorer');
  });

  it('returns a built-in to the builtin map on the way back', () => {
    handler.moveContainerToRail('view.explorer', 'right');
    expect(handler.builtinSidebarContainers.has('view.explorer')).toBe(false);

    handler.moveContainerToRail('view.explorer', 'left');

    expect(handler.railOf('view.explorer')).toBe('left');
    expect(handler.builtinSidebarContainers.has('view.explorer')).toBe(true);
    expect(explorer.element.parentElement).toBe(sidebarSlot);
    expect(leftBar.icons).toContain('view.explorer');
    expect(rightBar.icons).not.toContain('view.explorer');
  });

  it('is a no-op toward the rail it is already in', () => {
    expect(handler.moveContainerToRail('view.explorer', 'left')).toBe(false);
  });

  it('shows a hidden target rail when a container docks into it', () => {
    (aux as { visible: boolean }).visible = false;
    handler.moveContainerToRail('view.explorer', 'right');
    expect(toggles).toContain('aux');
  });

  it('hands the left rail to a survivor when its active container leaves', () => {
    const search = new ViewContainer('sidebar.view.search');
    search.setMode('stacked');
    sidebarSlot.appendChild(search.element);
    handler.registerBuiltinSidebarContainer('view.search', search);

    handler.moveContainerToRail('view.explorer', 'right');
    expect(handler.activeSidebarContainerId).toBe('view.search');
  });

  it('persists placements and applies them as pending to later arrivals', () => {
    handler.moveContainerToRail('view.explorer', 'right');
    const saved = handler.railAssignments();
    expect(saved).toContainEqual({ id: 'view.explorer', rail: 'right' });

    // Simulate the next session: container registered at its default (left),
    // then the restored placement applies.
    handler.moveContainerToRail('view.explorer', 'left');
    handler.setPendingRailAssignments(saved);
    handler.applyPendingRailAssignment('view.explorer');
    expect(handler.railOf('view.explorer')).toBe('right');
  });

  it('fires the rails-changed event on every move', () => {
    const changed = vi.fn();
    handler.onDidChangeRails(changed);
    handler.moveContainerToRail('view.explorer', 'right');
    handler.moveContainerToRail('view.explorer', 'left');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  // ── The restart order: placement restores BEFORE providers register ──
  //
  // Field bug: planner moved to the right rail, app restarted — empty
  // container, forever. The saved placement moves the container out of
  // the builtin sidebar map at boot; the tool's provider registers
  // AFTERWARD, and placeholder replacement searched only that one map.
  // Content that had worked all session died on restart.

  function placeholderView(id: string, name: string) {
    const element = document.createElement('div');
    element.classList.add('view');
    return {
      id, name,
      element,
      createElement(container: HTMLElement) { container.appendChild(element); },
      setVisible() {}, layout() {}, focus() {},
      minimumWidth: 0, maximumWidth: Infinity, minimumHeight: 0, maximumHeight: Infinity,
      saveState: () => ({}), restoreState: () => {},
      dispose() {},
    };
  }

  function wireProcessor() {
    const vm = new ViewManager();
    const processor = new ViewContributionProcessor(vm);
    handler.setViewContribution(processor);
    handler.wireViewContributionEvents();
    return processor;
  }

  it('placeholder replacement follows a container moved to the RIGHT RAIL before its provider registered', () => {
    const processor = wireProcessor();
    explorer.addView(placeholderView('view.test', 'Planner') as never);

    handler.moveContainerToRail('view.explorer', 'right'); // restore order
    processor.registerProvider('view.test', {
      resolveView: (_id, el) => { el.textContent = 'LIVE'; },
    });

    const body = explorer.element.querySelector('[data-view-id="view.test"] .view-section-body');
    expect(body?.textContent).toBe('LIVE');
  });

  it('a floating box’s reveal icon follows the area its box occupies', () => {
    handler.undockContainer('view.explorer');
    expect(leftBar.icons.includes('view.explorer')).toBe(true); // default reveal home

    handler.setFloatingIconRail('view.explorer', 'right');
    expect(leftBar.icons.includes('view.explorer')).toBe(false);
    expect(rightBar.icons.includes('view.explorer')).toBe(true);

    handler.setFloatingIconRail('view.explorer', 'left');
    expect(rightBar.icons.includes('view.explorer')).toBe(false);
    expect(leftBar.icons.includes('view.explorer')).toBe(true);

    // Not floating any more — the call becomes a no-op.
    handler.dockContainer('view.explorer', explorer, 'left');
    handler.setFloatingIconRail('view.explorer', 'right');
    expect(rightBar.icons.includes('view.explorer')).toBe(false);
  });

  it('placeholder replacement follows a container seated in a FLOATING box', () => {
    const processor = wireProcessor();
    explorer.addView(placeholderView('view.test', 'Planner') as never);

    expect(handler.undockContainer('view.explorer')).toBeDefined(); // restore order
    processor.registerProvider('view.test', {
      resolveView: (_id, el) => { el.textContent = 'LIVE'; },
    });

    const body = explorer.element.querySelector('[data-view-id="view.test"] .view-section-body');
    expect(body?.textContent).toBe('LIVE');
  });
});

// ── The ribbon as a drag surface ────────────────────────────────────────────

describe('activity bar as a container drag surface', () => {
  function makeBar(id: PartId, tooltip: 'left' | 'right'): ActivityBarPart {
    const bar = new ActivityBarPart(id, 'Bar', tooltip, PartPosition.Right);
    const host = document.createElement('div');
    document.body.appendChild(host);
    bar.create(host);
    return bar;
  }

  function dragEvent(type: string, store: Map<string, string>): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', {
      configurable: true,
      value: {
        get types() { return [...store.keys()]; },
        dropEffect: '', effectAllowed: '',
        setData: (t: string, v: string) => { store.set(t, v); },
        getData: (t: string) => store.get(t) ?? '',
      },
    });
    return ev;
  }

  it('stamps the container payload on an icon drag', () => {
    const bar = makeBar(PartId.ActivityBar, 'right');
    bar.addIcon({ id: 'view.explorer', icon: 'E', label: 'Explorer', source: 'builtin' });
    const btn = bar.element.querySelector<HTMLElement>('[data-icon-id="view.explorer"]')!;

    const store = new Map<string, string>();
    btn.dispatchEvent(dragEvent('dragstart', store));

    expect(store.has(CONTAINER_DRAG_TYPE)).toBe(true);
    expect(JSON.parse(store.get(CONTAINER_DRAG_TYPE)!)).toEqual({ containerId: 'view.explorer' });
    bar.dispose();
  });

  it('reports a foreign icon dropped on it, and ignores its own reorders', () => {
    const left = makeBar(PartId.ActivityBar, 'right');
    const right = makeBar(PartId.ActivityBarRight, 'left');
    left.addIcon({ id: 'view.explorer', icon: 'E', label: 'Explorer', source: 'builtin' });

    const docked = vi.fn();
    right.onDidDropContainerIcon(docked);

    // Foreign: payload from the LEFT bar's icon, dropped on the RIGHT bar.
    const store = new Map<string, string>();
    store.set(CONTAINER_DRAG_TYPE, JSON.stringify({ containerId: 'view.explorer' }));
    right.contentElement.dispatchEvent(dragEvent('dragover', store));
    right.contentElement.dispatchEvent(dragEvent('drop', store));
    expect(docked).toHaveBeenCalledWith({ containerId: 'view.explorer' });

    // Internal: a reorder within one bar must NOT read as a dock request.
    const own = vi.fn();
    left.onDidDropContainerIcon(own);
    const btn = left.element.querySelector<HTMLElement>('[data-icon-id="view.explorer"]')!;
    const ownStore = new Map<string, string>();
    btn.dispatchEvent(dragEvent('dragstart', ownStore));
    left.contentElement.dispatchEvent(dragEvent('drop', ownStore));
    expect(own).not.toHaveBeenCalled();

    left.dispose();
    right.dispose();
  });
});
