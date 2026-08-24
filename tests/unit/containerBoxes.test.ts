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

  it('asks to dock back from its header control', () => {
    const box = new ContainerBox('view.explorer', 'Explorer');
    const requested = vi.fn();
    box.onDidRequestDock(requested);
    box.element.querySelector<HTMLElement>('.container-box-dock-btn')!.click();
    expect(requested).toHaveBeenCalledTimes(1);
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
      requestSave: () => calls.push('save'),
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
