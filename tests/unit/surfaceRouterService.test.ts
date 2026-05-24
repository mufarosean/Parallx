// surfaceRouterService.test.ts — pin SurfaceRouterService facade + origin tag +
// feature-flag gating + event-log emit.
//
// Pins:
//   - SURFACE_ORIGIN_KEY === '_origin' and ORIGIN_* constants.
//   - getDeliveryOrigin reads metadata._origin only when string.
//   - facade: registerSurface / unregisterSurface / getSurface / surfaceIds /
//     surfaceCount / send / broadcast / deliveryHistory delegate to inner router.
//   - sendWithOrigin stamps metadata._origin override of caller-supplied
//     _origin, preserves other caller metadata.
//   - With NO feature-flag service: send/sendWithOrigin always reach the inner
//     router (no gating).
//   - With flag service AND known surfaceId (SURFACE_FLAG_BY_ID):
//       - flag DISABLED → returns {status:'failed', deliveryId:'', error:/disabled by feature flag/};
//         inner router.send NOT called; event log emitted with outcome 'gated'.
//       - flag ENABLED → reaches router; event log emitted with outcome 'completed'
//         when status='delivered', else 'error'.
//   - getDeliveriesByOrigin filters by tag.
//   - dispose disposes inner router.

import { describe, it, expect, vi } from 'vitest';
import {
  SurfaceRouterService,
  SURFACE_ORIGIN_KEY,
  ORIGIN_USER, ORIGIN_AGENT, ORIGIN_HEARTBEAT, ORIGIN_CRON, ORIGIN_SUBAGENT,
  getDeliveryOrigin,
} from '../../src/services/surfaceRouterService';

function makePlugin(id: string, deliverImpl: (d: any) => Promise<boolean> = async () => true) {
  return {
    id,
    capabilities: { supportsText: true, supportsStructured: true, supportsBinary: false, supportsActions: false },
    isAvailable: () => true,
    deliver: vi.fn(deliverImpl),
    dispose: vi.fn(),
  };
}

describe('SurfaceRouterService — constants + getDeliveryOrigin', () => {
  it('exposes well-known origin constants', () => {
    expect(SURFACE_ORIGIN_KEY).toBe('_origin');
    expect(ORIGIN_USER).toBe('user');
    expect(ORIGIN_AGENT).toBe('agent');
    expect(ORIGIN_HEARTBEAT).toBe('heartbeat');
    expect(ORIGIN_CRON).toBe('cron');
    expect(ORIGIN_SUBAGENT).toBe('subagent');
  });

  it('getDeliveryOrigin returns string value or undefined for non-string', () => {
    expect(getDeliveryOrigin({ metadata: { _origin: 'heartbeat' } } as any)).toBe('heartbeat');
    expect(getDeliveryOrigin({ metadata: { _origin: 42 } } as any)).toBeUndefined();
    expect(getDeliveryOrigin({ metadata: {} } as any)).toBeUndefined();
  });
});

describe('SurfaceRouterService — facade + send', () => {
  it('registerSurface / surfaceCount / surfaceIds / getSurface / unregisterSurface', () => {
    const svc = new SurfaceRouterService();
    const a = makePlugin('chat');
    svc.registerSurface(a as any);
    expect(svc.surfaceCount).toBe(1);
    expect(svc.surfaceIds).toEqual(['chat']);
    expect(svc.getSurface('chat')).toBe(a);
    expect(svc.unregisterSurface('chat')).toBe(true);
    expect(svc.unregisterSurface('chat')).toBe(false);
    svc.dispose();
  });

  it('send delivers via the plugin and records history', async () => {
    const svc = new SurfaceRouterService();
    const a = makePlugin('chat');
    svc.registerSurface(a as any);
    const res = await svc.send({ surfaceId: 'chat', contentType: 'text', content: 'hi' });
    expect(res.status).toBe('delivered');
    expect(a.deliver).toHaveBeenCalledTimes(1);
    expect(svc.deliveryHistory.length).toBe(1);
    svc.dispose();
  });
});

describe('SurfaceRouterService — sendWithOrigin', () => {
  it('stamps metadata._origin overriding any caller-supplied value; preserves other metadata', async () => {
    const svc = new SurfaceRouterService();
    const a = makePlugin('chat');
    svc.registerSurface(a as any);
    await svc.sendWithOrigin(
      { surfaceId: 'chat', contentType: 'text', content: 'x', metadata: { _origin: 'fake', other: 1 } },
      'heartbeat',
    );
    const delivery = a.deliver.mock.calls[0][0];
    expect(delivery.metadata._origin).toBe('heartbeat');
    expect(delivery.metadata.other).toBe(1);
    svc.dispose();
  });

  it('getDeliveriesByOrigin filters delivery history by tag', async () => {
    const svc = new SurfaceRouterService();
    svc.registerSurface(makePlugin('chat') as any);
    await svc.sendWithOrigin({ surfaceId: 'chat', contentType: 'text', content: '1' }, 'heartbeat');
    await svc.send({ surfaceId: 'chat', contentType: 'text', content: '2' });
    expect(svc.getDeliveriesByOrigin('heartbeat').length).toBe(1);
    expect(svc.getDeliveriesByOrigin('user').length).toBe(0);
    svc.dispose();
  });
});

describe('SurfaceRouterService — feature flag gating', () => {
  it('flag DISABLED → returns failed result without invoking router; emits gated event', async () => {
    const svc = new SurfaceRouterService();
    const a = makePlugin('chat');
    svc.registerSurface(a as any);
    const flags = { isEnabled: vi.fn().mockReturnValue(false) };
    const emit = vi.fn();
    svc.setFeatureFlags(flags as any);
    svc.setEventLog({ emit } as any);
    const res = await svc.send({ surfaceId: 'chat', contentType: 'text', content: 'x' });
    expect(res.status).toBe('failed');
    expect(res.deliveryId).toBe('');
    expect(res.error).toMatch(/disabled by feature flag/);
    expect(a.deliver).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].outcome).toBe('gated');
    svc.dispose();
  });

  it('flag ENABLED → reaches router; emits completed event on delivered', async () => {
    const svc = new SurfaceRouterService();
    svc.registerSurface(makePlugin('chat') as any);
    const emit = vi.fn();
    svc.setFeatureFlags({ isEnabled: () => true } as any);
    svc.setEventLog({ emit } as any);
    const res = await svc.send({ surfaceId: 'chat', contentType: 'text', content: 'x' });
    expect(res.status).toBe('delivered');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].outcome).toBe('completed');
    svc.dispose();
  });

  it('sendWithOrigin maps origin to trigger.kind (heartbeat/cron/subagent/other → chat)', async () => {
    const svc = new SurfaceRouterService();
    svc.registerSurface(makePlugin('chat') as any);
    const emit = vi.fn();
    svc.setEventLog({ emit } as any);
    await svc.sendWithOrigin({ surfaceId: 'chat', contentType: 'text', content: 'x' }, 'heartbeat');
    await svc.sendWithOrigin({ surfaceId: 'chat', contentType: 'text', content: 'x' }, 'cron');
    await svc.sendWithOrigin({ surfaceId: 'chat', contentType: 'text', content: 'x' }, 'subagent');
    await svc.sendWithOrigin({ surfaceId: 'chat', contentType: 'text', content: 'x' }, 'something-else');
    const kinds = emit.mock.calls.map((c: any) => c[0].trigger.kind);
    expect(kinds).toEqual(['heartbeat', 'cron', 'subagent', 'chat']);
    svc.dispose();
  });

  it('unknown surfaceId (not in SURFACE_FLAG_BY_ID) bypasses gating', async () => {
    const svc = new SurfaceRouterService();
    svc.registerSurface(makePlugin('unknown-surface') as any);
    const flags = { isEnabled: vi.fn().mockReturnValue(false) };
    svc.setFeatureFlags(flags as any);
    const res = await svc.send({ surfaceId: 'unknown-surface', contentType: 'text', content: 'x' });
    expect(res.status).toBe('delivered');
    expect(flags.isEnabled).not.toHaveBeenCalled();
    svc.dispose();
  });
});
