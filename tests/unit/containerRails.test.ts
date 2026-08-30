/**
 * Phase A — containers are citizens, rails are stacks.
 * Reworked for Retirement 4a: ONE sidebar path — every sidebar container
 * (Explorer included) arrives through the contributed pipeline.
 *
 * Pins the rail mechanics end to end: a contributed container seats in the
 * sidebar and auto-activates when it is first, moves to the other rail WITH
 * its icon and its DOM, active-state bookkeeping heals on both sides, rail
 * placements survive as pending assignments for containers that arrive
 * after restore (legacy pre-4a ids resolving to their manifest ids), and a
 * provider registering AFTER its container moved or floated still fills the
 * view. Plus the ribbon itself: an icon drag carries the container payload,
 * and a foreign icon dropped on a ribbon reports the dock request.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  WorkbenchContributionHandler,
  resolveLegacyContainerId,
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

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('container rails (one contributed sidebar path)', () => {
  let handler: WorkbenchContributionHandler;
  let processor: ViewContributionProcessor;
  let leftBar: FakeBar;
  let rightBar: FakeBar;
  let sidebar: ReturnType<typeof fakeRailPart>;
  let aux: ReturnType<typeof fakeRailPart>;
  let sidebarSlot: HTMLElement;
  let toggles: string[];

  /** Contribute a sidebar container (and optionally views) the manifest way. */
  function contribute(toolId: string, containerId: string, title: string, viewIds: string[] = []): void {
    processor.processContributions({
      manifest: {
        id: toolId,
        contributes: {
          viewContainers: [{ id: containerId, title, icon: 'folder', location: 'sidebar' as const }],
          views: viewIds.map((id) => ({ id, name: id, defaultContainerId: containerId })),
        },
      },
    } as never);
  }

  function explorerVc(): ViewContainer {
    return handler.contributedSidebarContainers.get('explorer-container') as ViewContainer;
  }

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

    const vm = new ViewManager();
    processor = new ViewContributionProcessor(vm);
    handler.setViewManager(vm);
    handler.setViewContribution(processor);
    handler.wireViewContributionEvents();

    contribute('parallx.explorer', 'explorer-container', 'Explorer');
  });

  it('seats a contributed sidebar container stacked, iconed, and active when first', () => {
    const vc = explorerVc();
    expect(vc).toBeDefined();
    expect(vc.mode).toBe('stacked');
    expect(vc.element.parentElement).toBe(sidebarSlot);
    expect(leftBar.icons).toContain('explorer-container');
    expect(handler.activeSidebarContainerId).toBe('explorer-container');
    expect(leftBar.active).toBe('explorer-container');
  });

  it('moves a container to the right rail with its icon and its DOM', () => {
    expect(handler.railOf('explorer-container')).toBe('left');
    const vc = explorerVc();

    const moved = handler.moveContainerToRail('explorer-container', 'right');

    expect(moved).toBe(true);
    expect(handler.railOf('explorer-container')).toBe('right');
    // The DOM travelled into the right rail's slot…
    expect(vc.element.parentElement).toBe(aux.viewContainerSlot);
    // …the icon crossed ribbons…
    expect(leftBar.icons).not.toContain('explorer-container');
    expect(rightBar.icons).toContain('explorer-container');
    // …and it is the right rail's shown container.
    expect(rightBar.active).toBe('explorer-container');
  });

  it('returns to the sidebar map on the way back', () => {
    handler.moveContainerToRail('explorer-container', 'right');
    expect(handler.contributedSidebarContainers.has('explorer-container')).toBe(false);

    handler.moveContainerToRail('explorer-container', 'left');

    expect(handler.railOf('explorer-container')).toBe('left');
    expect(handler.contributedSidebarContainers.has('explorer-container')).toBe(true);
    expect(explorerVc().element.parentElement).toBe(sidebarSlot);
    expect(leftBar.icons).toContain('explorer-container');
    expect(rightBar.icons).not.toContain('explorer-container');
  });

  it('is a no-op toward the rail it is already in', () => {
    expect(handler.moveContainerToRail('explorer-container', 'left')).toBe(false);
  });

  it('shows a hidden target rail when a container docks into it', () => {
    (aux as { visible: boolean }).visible = false;
    handler.moveContainerToRail('explorer-container', 'right');
    expect(toggles).toContain('aux');
  });

  it('hands the left rail to a survivor when its active container leaves', () => {
    contribute('parallx.search', 'search-container', 'Search');

    handler.moveContainerToRail('explorer-container', 'right');
    expect(handler.activeSidebarContainerId).toBe('search-container');
  });

  it('persists placements and applies them as pending to later arrivals', () => {
    handler.moveContainerToRail('explorer-container', 'right');
    const saved = handler.railAssignments();
    expect(saved).toContainEqual({ id: 'explorer-container', rail: 'right' });

    // Simulate the next session: container registered at its default (left),
    // then the restored placement applies.
    handler.moveContainerToRail('explorer-container', 'left');
    handler.setPendingRailAssignments(saved);
    handler.applyPendingRailAssignment('explorer-container');
    expect(handler.railOf('explorer-container')).toBe('right');
  });

  it('resolves pre-4a builtin ids in restored placements to their manifest ids', () => {
    expect(resolveLegacyContainerId('view.explorer')).toBe('explorer-container');
    expect(resolveLegacyContainerId('view.search')).toBe('search-container');
    expect(resolveLegacyContainerId('anything-else')).toBe('anything-else');

    // A rail assignment saved before the cut still lands.
    handler.setPendingRailAssignments([{ id: 'view.explorer', rail: 'right' }]);
    handler.applyPendingRailAssignment('explorer-container');
    expect(handler.railOf('explorer-container')).toBe('right');
  });

  it('keeps files above Open Editors — manifest order IS stacked-section order', async () => {
    // Field regression after the 4a cut: the manifest listed Open Editors
    // first, so the Explorer sidebar flipped. Views seat in contribution
    // order; the explorer manifest must keep the files view first.
    const { EXPLORER_MANIFEST } = await import('../../src/tools/builtinManifests');
    const viewIds = EXPLORER_MANIFEST.contributes?.views?.map((v) => v.id) ?? [];
    expect(viewIds.indexOf('view.explorer')).toBeGreaterThanOrEqual(0);
    expect(viewIds.indexOf('view.explorer')).toBeLessThan(viewIds.indexOf('view.openEditors'));
  });

  it('fires the rails-changed event on every move', () => {
    const changed = vi.fn();
    handler.onDidChangeRails(changed);
    handler.moveContainerToRail('explorer-container', 'right');
    handler.moveContainerToRail('explorer-container', 'left');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  // ── The restart order: placement restores BEFORE providers register ──
  //
  // The old field bug: planner moved to the right rail, app restarted —
  // empty container, forever, because placeholder replacement searched one
  // map. The contributed path has no map search at all: the view instance
  // resolves its own provider whenever it registers, wherever the
  // container lives. These pin that the root cause stays dead.

  it('a provider registering AFTER its container moved to the RIGHT RAIL still fills the view', async () => {
    contribute('parallx.planner', 'planner-container', 'Planner', ['view.planner']);
    await tick(); // _addViewToContainer is async

    handler.moveContainerToRail('planner-container', 'right'); // restore order
    processor.registerProvider('view.planner', {
      resolveView: (_id, el) => { el.textContent = 'LIVE'; },
    });

    const vc = handler.contributedAuxBarContainers.get('planner-container') as ViewContainer;
    expect(vc.element.querySelector('.tool-view-content')?.textContent).toBe('LIVE');
  });

  it('a provider registering AFTER its container floated still fills the view', async () => {
    contribute('parallx.planner', 'planner-container', 'Planner', ['view.planner']);
    await tick();

    const undocked = handler.undockContainer('planner-container');
    expect(undocked).toBeDefined();
    processor.registerProvider('view.planner', {
      resolveView: (_id, el) => { el.textContent = 'LIVE'; },
    });

    expect(undocked!.vc.element.querySelector('.tool-view-content')?.textContent).toBe('LIVE');
  });

  it('a floating box’s reveal icon follows the area its box occupies', () => {
    handler.undockContainer('explorer-container');
    expect(leftBar.icons.includes('explorer-container')).toBe(true); // default reveal home

    handler.setFloatingIconRail('explorer-container', 'right');
    expect(leftBar.icons.includes('explorer-container')).toBe(false);
    expect(rightBar.icons.includes('explorer-container')).toBe(true);

    handler.setFloatingIconRail('explorer-container', 'left');
    expect(rightBar.icons.includes('explorer-container')).toBe(false);
    expect(leftBar.icons.includes('explorer-container')).toBe(true);

    // Not floating any more — the call becomes a no-op.
    const vc = explorerVc() ?? new ViewContainer('explorer-container');
    handler.dockContainer('explorer-container', vc, 'left');
    handler.setFloatingIconRail('explorer-container', 'right');
    expect(rightBar.icons.includes('explorer-container')).toBe(false);
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
    bar.addIcon({ id: 'explorer-container', icon: 'E', label: 'Explorer', source: 'contributed' });
    const btn = bar.element.querySelector<HTMLElement>('[data-icon-id="explorer-container"]')!;

    const store = new Map<string, string>();
    btn.dispatchEvent(dragEvent('dragstart', store));

    expect(store.has(CONTAINER_DRAG_TYPE)).toBe(true);
    expect(JSON.parse(store.get(CONTAINER_DRAG_TYPE)!)).toEqual({ containerId: 'explorer-container' });
    bar.dispose();
  });

  it('reports a foreign icon dropped on it, and ignores its own reorders', () => {
    const left = makeBar(PartId.ActivityBar, 'right');
    const right = makeBar(PartId.ActivityBarRight, 'left');
    left.addIcon({ id: 'explorer-container', icon: 'E', label: 'Explorer', source: 'contributed' });

    const docked = vi.fn();
    right.onDidDropContainerIcon(docked);

    // Foreign: payload from the LEFT bar's icon, dropped on the RIGHT bar.
    const store = new Map<string, string>();
    store.set(CONTAINER_DRAG_TYPE, JSON.stringify({ containerId: 'explorer-container' }));
    right.contentElement.dispatchEvent(dragEvent('dragover', store));
    right.contentElement.dispatchEvent(dragEvent('drop', store));
    expect(docked).toHaveBeenCalledWith({ containerId: 'explorer-container' });

    // Internal: a reorder within one bar must NOT read as a dock request.
    const own = vi.fn();
    left.onDidDropContainerIcon(own);
    const btn = left.element.querySelector<HTMLElement>('[data-icon-id="explorer-container"]')!;
    const ownStore = new Map<string, string>();
    btn.dispatchEvent(dragEvent('dragstart', ownStore));
    left.contentElement.dispatchEvent(dragEvent('drop', ownStore));
    expect(own).not.toHaveBeenCalled();

    left.dispose();
    right.dispose();
  });
});
