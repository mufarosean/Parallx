/**
 * Phase A, slice 2 — floating container boxes.
 *
 * Pins the box lifecycle (shell → seated → unseated), the manager's
 * detach/move/dock/prune routing against a fake host, and the property the
 * restore story leans on: a waiting shell keeps a floating container's
 * place until its tool arrives, and a box whose leaf did not survive a tree
 * restore re-docks its container instead of losing it.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  ContainerBox,
  ContainerBoxManager,
  containerBoxViewId,
  type ContainerBoxHost,
} from '../../src/workbench/containerBox';
import { ViewContainer } from '../../src/views/viewContainer';
import { CONTAINER_DRAG_TYPE } from '../../src/platform/dragTypes';
import { Orientation } from '../../src/layout/layoutTypes';
import type { PartDropZone } from '../../src/workbench/partDrag';

describe('ContainerBox', () => {
  it('starts as a waiting shell and seats its container on arrival', () => {
    const box = new ContainerBox('chat-container', 'chat-container');
    expect(box.isWaiting).toBe(true);
    expect(box.element.querySelector('.container-box-waiting-note')).not.toBeNull();
    expect(box.id).toBe('container:chat-container');

    const vc = new ViewContainer('chat-container');
    box.seat(vc, 'Chat');
    expect(box.isWaiting).toBe(false);
    expect(box.element.querySelector('.container-box-waiting-note')).toBeNull();
    expect(vc.element.parentElement).toBe(box.element.querySelector('.container-box-body'));
    expect(box.element.querySelector('.container-box-title')?.textContent).toBe('CHAT');

    expect(box.unseat()).toBe(vc);
    expect(box.isWaiting).toBe(true);
    box.dispose();
  });

  it('drags by its header with the container payload', () => {
    const box = new ContainerBox('view.explorer', 'Explorer');
    const header = box.element.querySelector<HTMLElement>('.container-box-header')!;
    expect(header.draggable).toBe(true);

    const store = new Map<string, string>();
    const ev = new Event('dragstart', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: {
        effectAllowed: '',
        setData: (t: string, v: string) => { store.set(t, v); },
      },
    });
    header.dispatchEvent(ev);
    expect(JSON.parse(store.get(CONTAINER_DRAG_TYPE)!)).toEqual({ containerId: 'view.explorer' });
    box.dispose();
  });

  it('asks for the placement menu from its ⋯ control and from right-click', () => {
    const box = new ContainerBox('view.explorer', 'Explorer');
    const requested = vi.fn();
    box.onDidRequestMenu(requested);
    box.element.querySelector<HTMLElement>('.container-box-menu-btn')!.click();
    expect(requested).toHaveBeenCalledTimes(1);
    box.element.querySelector<HTMLElement>('.container-box-header')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(requested).toHaveBeenCalledTimes(2);
    box.dispose();
  });
});

describe('ContainerBoxManager', () => {
  let manager: ContainerBoxManager;
  let host: ContainerBoxHost;
  let calls: string[];
  let dockable: Map<string, ViewContainer>;

  beforeEach(() => {
    calls = [];
    dockable = new Map();
    host = {
      undockContainer: (id) => {
        const vc = dockable.get(id);
        if (!vc) return undefined;
        dockable.delete(id);
        calls.push(`undock:${id}`);
        return { vc, label: id };
      },
      dockContainer: (id, _vc, rail) => {
        dockable.set(id, _vc);
        calls.push(`dock:${id}:${rail}`);
      },
      addFloatingView: (view, zone) => {
        calls.push(`add:${view.id}:${zone?.kind ?? 'default'}`);
      },
      removeFloatingView: (viewId) => calls.push(`remove:${viewId}`),
      moveFloating: (viewId, zone) => calls.push(`move:${viewId}:${zone.kind}`),
      moveFloatingToEdge: (viewId, orientation, before) =>
        calls.push(`edge:${viewId}:${orientation}:${before}`),
      requestSave: () => calls.push('save'),
      executeCommandFrom: async (_origin, id, ...args) => calls.push(`cmd:${id}:${args.join(':')}`),
    };
    manager = new ContainerBoxManager(host);
  });

  const zoneBeside: PartDropZone = {
    kind: 'beside', targetId: 'workbench.parts.editor',
    orientation: Orientation.Horizontal, before: false,
  };

  it('floats a docked container into a box at the drop zone', () => {
    dockable.set('view.explorer', new ViewContainer('sidebar.view.explorer'));

    expect(manager.float('view.explorer', zoneBeside)).toBe(true);
    expect(manager.has('view.explorer')).toBe(true);
    expect(calls).toContain('undock:view.explorer');
    expect(calls).toContain('add:container:view.explorer:beside');
    expect(calls).toContain('save');
  });

  it('routes a drop on an already-floating container as a box move', () => {
    dockable.set('view.explorer', new ViewContainer('sidebar.view.explorer'));
    manager.float('view.explorer');
    calls.length = 0;

    manager.handleContainerDrop('view.explorer', zoneBeside);
    expect(calls).toEqual(['move:container:view.explorer:beside', 'save']);
  });

  it('docks a floating container back: box leaves the grid, container re-rails', () => {
    dockable.set('view.explorer', new ViewContainer('sidebar.view.explorer'));
    manager.float('view.explorer');
    calls.length = 0;

    expect(manager.dock('view.explorer', 'right')).toBe(true);
    expect(manager.has('view.explorer')).toBe(false);
    expect(calls).toContain('remove:container:view.explorer');
    expect(calls).toContain('dock:view.explorer:right');
  });

  it('keeps a waiting shell for a restored box and seats the late arrival', () => {
    // Restore resolves the leaf before the tool has activated.
    const shell = manager.resolveShell(containerBoxViewId('chat-container'));
    expect(shell).toBeDefined();
    expect(manager.resolveShell(containerBoxViewId('chat-container'))).toBe(shell);
    expect(manager.has('chat-container')).toBe(true);

    // Nothing to seat yet — the container is not dockable anywhere.
    manager.seatWaiting();
    expect((shell as ContainerBox).isWaiting).toBe(true);

    // The tool activates; its container registers; the shell seats it.
    dockable.set('chat-container', new ViewContainer('chat-container'));
    manager.seatWaiting();
    expect((shell as ContainerBox).isWaiting).toBe(false);
  });

  it('the box menu offers the rails for a container, and docking works from it', () => {
    dockable.set('view.explorer', new ViewContainer('sidebar.view.explorer'));
    manager.float('view.explorer');
    calls.length = 0;

    const box = manager.resolveShell(containerBoxViewId('view.explorer')) as ContainerBox;
    box.element.querySelector<HTMLElement>('.container-box-menu-btn')!.click();
    try {
      const items = [...document.querySelectorAll<HTMLElement>('.context-menu-item')];
      const labels = items.map((i) => i.textContent ?? '');
      expect(labels.some((l) => l.includes('Dock To Left Rail'))).toBe(true);
      expect(labels.some((l) => l.includes('Dock To Right Rail'))).toBe(true);
      expect(labels.some((l) => l.includes('Move To Bottom Edge'))).toBe(true);

      // Menu choices route through the command bus (Phase B) — the host
      // receives the command, not a direct dock() call.
      items.find((i) => i.textContent?.includes('Dock To Right Rail'))!.click();
      expect(calls).toContain('cmd:workbench.action.container.dock:view.explorer:right');
    } finally {
      document.querySelectorAll('.context-menu').forEach((el) => el.remove());
    }
  });

  it('a detached panel view’s menu offers Return To Panel, not the rails', () => {
    dockable.set('panelview:view.terminal', new ViewContainer('panelview.view.terminal'));
    manager.float('panelview:view.terminal');
    calls.length = 0;

    const box = manager.resolveShell(containerBoxViewId('panelview:view.terminal')) as ContainerBox;
    box.element.querySelector<HTMLElement>('.container-box-menu-btn')!.click();
    try {
      const labels = [...document.querySelectorAll<HTMLElement>('.context-menu-item')]
        .map((i) => i.textContent ?? '');
      expect(labels.some((l) => l.includes('Return To Panel'))).toBe(true);
      expect(labels.some((l) => l.includes('Rail'))).toBe(false);
    } finally {
      document.querySelectorAll('.context-menu').forEach((el) => el.remove());
    }
  });

  it('re-docks a seated container whose leaf did not survive a tree restore', () => {
    dockable.set('view.explorer', new ViewContainer('sidebar.view.explorer'));
    manager.float('view.explorer');
    manager.resolveShell(containerBoxViewId('gone-tool'));
    calls.length = 0;

    manager.pruneAbsent(new Set<string>());

    // Seated → back to the left rail; waiting shell → simply gone.
    expect(calls).toContain('dock:view.explorer:left');
    expect(manager.has('view.explorer')).toBe(false);
    expect(manager.has('gone-tool')).toBe(false);
  });
});

describe('panel tabs as drag sources', () => {
  it('stamps a detachable payload on a view tab drag', () => {
    const panel = new ViewContainer('panel');
    document.body.appendChild(panel.element);

    const fakeView = {
      id: 'view.terminal',
      name: 'Terminal',
      element: document.createElement('div'),
      createElement(parent: HTMLElement) { parent.appendChild(this.element); return this.element; },
      layout() {},
      setVisible() {},
      focus() {},
      saveState() { return {}; },
      restoreState() {},
      dispose() {},
      minimumWidth: 0, maximumWidth: Infinity, minimumHeight: 0, maximumHeight: Infinity,
    };
    panel.addView(fakeView as never);

    const tab = panel.element.querySelector<HTMLElement>('.view-tab[data-view-id="view.terminal"]');
    expect(tab).not.toBeNull();
    expect(tab!.draggable).toBe(true);

    const store = new Map<string, string>();
    const ev = new Event('dragstart', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: { setData: (t: string, v: string) => { store.set(t, v); } },
    });
    tab!.dispatchEvent(ev);

    // The tab reorders within the panel by its PRIVATE payload (never
    // text/plain — a missed drop over the canvas used to paste the view
    // id into notes), and detaches into the grid by the container payload.
    expect(store.get('application/x-parallx-view-tab')).toBe('view.terminal');
    expect(store.has('text/plain')).toBe(false);
    expect(JSON.parse(store.get(CONTAINER_DRAG_TYPE)!)).toEqual({
      containerId: 'panelview:view.terminal',
    });

    panel.dispose();
  });

  it('round-trips a view between the panel and a wrapper container', () => {
    const panel = new ViewContainer('panel');
    document.body.appendChild(panel.element);
    const fakeView = {
      id: 'view.output',
      name: 'Output',
      element: document.createElement('div'),
      createElement(parent: HTMLElement) { parent.appendChild(this.element); return this.element; },
      layout() {}, setVisible() {}, focus() {},
      saveState() { return {}; }, restoreState() {},
      dispose() {},
      minimumWidth: 0, maximumWidth: Infinity, minimumHeight: 0, maximumHeight: Infinity,
    };
    panel.addView(fakeView as never);
    expect(panel.getView('view.output')).toBeDefined();

    // Detach: the view leaves the panel for a wrapper (what the box seats).
    const view = panel.getView('view.output')!;
    panel.removeView('view.output');
    expect(panel.getView('view.output')).toBeUndefined();

    const wrapper = new ViewContainer('panelview.view.output');
    wrapper.hideTabBar();
    wrapper.addView(view);
    expect(wrapper.getView('view.output')).toBe(view);

    // Redock: back to the panel, wrapper gone.
    wrapper.removeView('view.output');
    wrapper.dispose();
    panel.addView(view);
    expect(panel.getView('view.output')).toBe(view);

    panel.dispose();
  });
});
