// layoutService.test.ts — pin ILayoutService facade behavior.
//
// Pins:
//   - Pre-host: container=undefined, layout() no-op, isVisible() → false,
//     setPartHidden() no-op (no throw).
//   - setHost binds container access.
//   - layout() invokes _hGrid.layout, _vGrid.layout, _layoutViewContainers in order.
//   - isVisible delegates to host.isPartVisible(partId).
//   - setPartHidden delegates to host.setPartHidden(hidden, partId).
//   - onDidChangePartVisibility relays the host event (single source of truth).
//   - Service does NOT fire its own event from setPartHidden — only via host relay.
//   - dispose disposes the relay subscription.

import { describe, it, expect, vi } from 'vitest';
import { LayoutService } from '../../src/services/layoutService';
import { Emitter } from '../../src/platform/events';
import type { PartVisibilityChangeEvent } from '../../src/services/serviceTypes';

function mkHost(over: Partial<any> = {}) {
  const visibility = new Emitter<PartVisibilityChangeEvent>();
  const host = {
    container: {} as any as HTMLElement,
    _hGrid: { layout: vi.fn(), resize: vi.fn() },
    _vGrid: { layout: vi.fn(), resize: vi.fn() },
    _layoutViewContainers: vi.fn(),
    isPartVisible: vi.fn((id: string) => id === 'sidebar'),
    setPartHidden: vi.fn(),
    onDidChangePartVisibility: visibility.event,
    _visibility: visibility,
    ...over,
  };
  return host as any;
}

describe('LayoutService — pre-host', () => {
  it('container is undefined before setHost', () => {
    const svc = new LayoutService();
    expect(svc.container).toBeUndefined();
  });

  it('layout() is a no-op when no host bound', () => {
    const svc = new LayoutService();
    expect(() => svc.layout()).not.toThrow();
  });

  it('isVisible returns false when no host bound', () => {
    const svc = new LayoutService();
    expect(svc.isVisible('sidebar')).toBe(false);
  });

  it('setPartHidden is a no-op when no host bound', () => {
    const svc = new LayoutService();
    expect(() => svc.setPartHidden(true, 'sidebar')).not.toThrow();
  });
});

describe('LayoutService — post-host delegation', () => {
  it('container exposes host container', () => {
    const svc = new LayoutService();
    const host = mkHost();
    svc.setHost(host);
    expect(svc.container).toBe(host.container);
  });

  it('layout() calls _hGrid.layout, _vGrid.layout, _layoutViewContainers', () => {
    const svc = new LayoutService();
    const host = mkHost();
    svc.setHost(host);
    svc.layout();
    expect(host._hGrid.layout).toHaveBeenCalledTimes(1);
    expect(host._vGrid.layout).toHaveBeenCalledTimes(1);
    expect(host._layoutViewContainers).toHaveBeenCalledTimes(1);
  });

  it('isVisible delegates to host.isPartVisible(partId)', () => {
    const svc = new LayoutService();
    const host = mkHost();
    svc.setHost(host);
    expect(svc.isVisible('sidebar')).toBe(true);
    expect(svc.isVisible('panel')).toBe(false);
    expect(host.isPartVisible).toHaveBeenCalledWith('sidebar');
  });

  it('setPartHidden delegates to host.setPartHidden(hidden, partId)', () => {
    const svc = new LayoutService();
    const host = mkHost();
    svc.setHost(host);
    svc.setPartHidden(true, 'panel');
    expect(host.setPartHidden).toHaveBeenCalledWith(true, 'panel');
    svc.setPartHidden(false, 'sidebar');
    expect(host.setPartHidden).toHaveBeenLastCalledWith(false, 'sidebar');
  });
});

describe('LayoutService — onDidChangePartVisibility relay', () => {
  it('relays host visibility events to subscribers', () => {
    const svc = new LayoutService();
    const host = mkHost();
    svc.setHost(host);
    const events: PartVisibilityChangeEvent[] = [];
    svc.onDidChangePartVisibility((e) => events.push(e));
    host._visibility.fire({ partId: 'sidebar', isVisible: false } as any);
    host._visibility.fire({ partId: 'panel', isVisible: true } as any);
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ partId: 'sidebar', isVisible: false });
    expect(events[1]).toEqual({ partId: 'panel', isVisible: true });
  });

  it('setPartHidden does NOT fire the service event directly (host is single source)', () => {
    const svc = new LayoutService();
    const host = mkHost();
    svc.setHost(host);
    const events: PartVisibilityChangeEvent[] = [];
    svc.onDidChangePartVisibility((e) => events.push(e));
    svc.setPartHidden(true, 'sidebar');
    // Host stub doesn't auto-fire; service must not synthesize an event.
    expect(events).toEqual([]);
  });
});

describe('LayoutService — dispose', () => {
  it('dispose detaches relay subscription so later host events do not propagate', () => {
    const svc = new LayoutService();
    const host = mkHost();
    svc.setHost(host);
    const events: PartVisibilityChangeEvent[] = [];
    svc.onDidChangePartVisibility((e) => events.push(e));
    svc.dispose();
    host._visibility.fire({ partId: 'sidebar', isVisible: false } as any);
    expect(events).toEqual([]);
  });
});
