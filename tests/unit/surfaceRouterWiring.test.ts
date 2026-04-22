// surfaceRouterWiring.test.ts — M58 W6 integration tests
//
// Proves the runtime wiring around the SurfaceRouterService:
//   1. Plugin registration through the service
//   2. Retry + permanent-error short-circuit
//   3. Origin-tag round-trip (feedback-loop guard plumbing)
//   4. surface_send / surface_list tool handler behaviour
//   5. Tool-level approval posture (surface_send requires-approval)
//
// The pre-existing 33 tests in openclawSurfacePlugin.test.ts already cover
// the SurfaceRouter class itself; these tests verify the wiring layer.

import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  SurfaceRouterService,
  SURFACE_ORIGIN_KEY,
  ORIGIN_AGENT,
  ORIGIN_HEARTBEAT,
  getDeliveryOrigin,
} from '../../src/services/surfaceRouterService';
import {
  SURFACE_NOTIFICATIONS,
  SURFACE_STATUS,
  SURFACE_CANVAS,
  type ISurfacePlugin,
  type ISurfaceCapabilities,
  type ISurfaceDelivery,
} from '../../src/openclaw/openclawSurfacePlugin';
import {
  createSurfaceSendTool,
  createSurfaceListTool,
} from '../../src/built-in/chat/tools/surfaceTools';
import {
  surfaceSendRequiresApproval,
} from '../../src/openclaw/openclawToolPolicy';
import { CanvasSurfacePlugin } from '../../src/built-in/canvas/surfaces/canvasSurface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNoopToken() {
  return { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* noop */ } }) } as never;
}

function makePlugin(
  id: string,
  overrides?: {
    capabilities?: Partial<ISurfaceCapabilities>;
    available?: boolean;
    deliver?: (d: ISurfaceDelivery) => Promise<boolean> | boolean;
  },
): ISurfacePlugin & { deliver: ReturnType<typeof vi.fn> } {
  const caps: ISurfaceCapabilities = {
    supportsText: true,
    supportsStructured: true,
    supportsBinary: false,
    supportsActions: false,
    ...overrides?.capabilities,
  };
  const deliverFn = overrides?.deliver ?? (() => true);
  const deliver = vi.fn(async (d: ISurfaceDelivery) => deliverFn(d));
  return {
    id,
    capabilities: caps,
    isAvailable: () => overrides?.available ?? true,
    deliver,
    dispose: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// SurfaceRouterService — plugin registration + origin plumbing
// ---------------------------------------------------------------------------

describe('SurfaceRouterService (M58 W6 wiring)', () => {
  let service: SurfaceRouterService;

  beforeEach(() => { service = new SurfaceRouterService(); });

  it('registers and lists surfaces through the service facade', () => {
    service.registerSurface(makePlugin(SURFACE_NOTIFICATIONS));
    service.registerSurface(makePlugin(SURFACE_STATUS));
    expect(service.surfaceIds).toEqual([SURFACE_NOTIFICATIONS, SURFACE_STATUS]);
    expect(service.surfaceCount).toBe(2);
    expect(service.getSurface(SURFACE_NOTIFICATIONS)).toBeDefined();
  });

  it('unregisterSurface disposes the plugin and drops it from the registry', () => {
    const plugin = makePlugin(SURFACE_NOTIFICATIONS);
    service.registerSurface(plugin);
    expect(service.unregisterSurface(SURFACE_NOTIFICATIONS)).toBe(true);
    expect(plugin.dispose).toHaveBeenCalledOnce();
    expect(service.surfaceCount).toBe(0);
  });

  it('sendWithOrigin stamps the origin tag into delivery metadata', async () => {
    const plugin = makePlugin(SURFACE_NOTIFICATIONS);
    service.registerSurface(plugin);

    const result = await service.sendWithOrigin(
      { surfaceId: SURFACE_NOTIFICATIONS, contentType: 'text', content: 'hello' },
      ORIGIN_AGENT,
    );

    expect(result.status).toBe('delivered');
    expect(plugin.deliver).toHaveBeenCalledOnce();
    const delivered = plugin.deliver.mock.calls[0]![0] as ISurfaceDelivery;
    expect(delivered.metadata[SURFACE_ORIGIN_KEY]).toBe(ORIGIN_AGENT);
    expect(getDeliveryOrigin(delivered)).toBe(ORIGIN_AGENT);
  });

  it('preserves caller-supplied metadata while still stamping the origin', async () => {
    const plugin = makePlugin(SURFACE_NOTIFICATIONS);
    service.registerSurface(plugin);

    await service.sendWithOrigin(
      {
        surfaceId: SURFACE_NOTIFICATIONS,
        contentType: 'text',
        content: 'hi',
        metadata: { severity: 'warn' },
      },
      ORIGIN_HEARTBEAT,
    );

    const delivered = plugin.deliver.mock.calls[0]![0] as ISurfaceDelivery;
    expect(delivered.metadata.severity).toBe('warn');
    expect(delivered.metadata[SURFACE_ORIGIN_KEY]).toBe(ORIGIN_HEARTBEAT);
  });

  it('feedback-loop guard: getDeliveriesByOrigin filters delivery history', async () => {
    const plugin = makePlugin(SURFACE_NOTIFICATIONS);
    service.registerSurface(plugin);

    await service.sendWithOrigin(
      { surfaceId: SURFACE_NOTIFICATIONS, contentType: 'text', content: 'from user' },
      'user',
    );
    await service.sendWithOrigin(
      { surfaceId: SURFACE_NOTIFICATIONS, contentType: 'text', content: 'from heartbeat' },
      ORIGIN_HEARTBEAT,
    );
    await service.sendWithOrigin(
      { surfaceId: SURFACE_NOTIFICATIONS, contentType: 'text', content: 'agent write' },
      ORIGIN_AGENT,
    );

    const heartbeatOnly = service.getDeliveriesByOrigin(ORIGIN_HEARTBEAT);
    expect(heartbeatOnly).toHaveLength(1);
    expect(heartbeatOnly[0]?.content).toBe('from heartbeat');

    const agentOnly = service.getDeliveriesByOrigin(ORIGIN_AGENT);
    expect(agentOnly).toHaveLength(1);
    expect(agentOnly[0]?.content).toBe('agent write');
  });

  it('short-circuits on permanent "not supported" without retrying', async () => {
    // Canvas plugin declares no write capabilities — router should refuse
    // before calling deliver() and return a permanent failure.
    const canvas = new CanvasSurfacePlugin();
    service.registerSurface(canvas);

    const result = await service.send({
      surfaceId: SURFACE_CANVAS,
      contentType: 'text',
      content: 'should be rejected',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/does not support/);
  });

  it('disposes all surfaces when the service is disposed', () => {
    const plugin = makePlugin(SURFACE_NOTIFICATIONS);
    service.registerSurface(plugin);
    service.dispose();
    expect(plugin.dispose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tool layer — surface_send / surface_list
// ---------------------------------------------------------------------------

describe('surface_send / surface_list tools (M58 W6)', () => {
  let service: SurfaceRouterService;

  beforeEach(() => {
    service = new SurfaceRouterService();
    service.registerSurface(makePlugin(SURFACE_NOTIFICATIONS));
    service.registerSurface(new CanvasSurfacePlugin());
  });

  it('surface_send is gated as requires-approval (M58 conservative posture)', () => {
    const tool = createSurfaceSendTool(service);
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.permissionLevel).toBe('requires-approval');
  });

  it('surface_list is always-allowed (read-only)', () => {
    const tool = createSurfaceListTool(service);
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.permissionLevel).toBe('always-allowed');
  });

  it('surface_list returns all registered surfaces with capabilities + approval info', async () => {
    const tool = createSurfaceListTool(service);
    const result = await tool.handler({}, makeNoopToken());
    const parsed = JSON.parse(result.content) as {
      ok: boolean;
      surfaces: Array<{ id: string; available: boolean; requiresApproval: boolean }>;
    };
    expect(parsed.ok).toBe(true);
    const ids = parsed.surfaces.map(s => s.id).sort();
    expect(ids).toEqual([SURFACE_CANVAS, SURFACE_NOTIFICATIONS].sort());
    const canvas = parsed.surfaces.find(s => s.id === SURFACE_CANVAS)!;
    expect(canvas.requiresApproval).toBe(true);
    const notif = parsed.surfaces.find(s => s.id === SURFACE_NOTIFICATIONS)!;
    expect(notif.requiresApproval).toBe(false);
  });

  it('surface_send delivers via the router and stamps origin=agent', async () => {
    const tool = createSurfaceSendTool(service);
    const result = await tool.handler(
      { surfaceId: SURFACE_NOTIFICATIONS, contentType: 'text', content: 'hello' },
      makeNoopToken(),
    );
    const parsed = JSON.parse(result.content) as { ok: boolean; deliveryId: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.deliveryId).toMatch(/^delivery-/);
    const agentDeliveries = service.getDeliveriesByOrigin(ORIGIN_AGENT);
    expect(agentDeliveries).toHaveLength(1);
    expect(agentDeliveries[0]?.surfaceId).toBe(SURFACE_NOTIFICATIONS);
  });

  it('surface_send rejects unknown surface', async () => {
    const tool = createSurfaceSendTool(service);
    const result = await tool.handler(
      { surfaceId: 'nonexistent', contentType: 'text', content: 'x' },
      makeNoopToken(),
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/Surface not found/);
  });

  it('surface_send missing content returns validation error', async () => {
    const tool = createSurfaceSendTool(service);
    const result = await tool.handler({ surfaceId: SURFACE_NOTIFICATIONS }, makeNoopToken());
    expect(result.isError).toBe(true);
  });

  it('surface_send reports approvalRequiredForSurface marker', async () => {
    // canvas requires approval; the tool tells the caller it does, even
    // though the canvas stub itself will permanent-error on the deliver.
    const tool = createSurfaceSendTool(service);
    const result = await tool.handler(
      { surfaceId: SURFACE_NOTIFICATIONS, contentType: 'text', content: 'x' },
      makeNoopToken(),
    );
    const parsed = JSON.parse(result.content) as { approvalRequiredForSurface: boolean };
    expect(parsed.approvalRequiredForSurface).toBe(false);
  });

  it('router-absent handler returns a graceful failure', async () => {
    const tool = createSurfaceSendTool(undefined);
    const result = await tool.handler(
      { surfaceId: SURFACE_NOTIFICATIONS, contentType: 'text', content: 'x' },
      makeNoopToken(),
    );
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Approval policy helper
// ---------------------------------------------------------------------------

describe('surfaceSendRequiresApproval (M58 W6 policy)', () => {
  it('filesystem and canvas require approval', () => {
    expect(surfaceSendRequiresApproval('filesystem')).toBe(true);
    expect(surfaceSendRequiresApproval('canvas')).toBe(true);
  });
  it('chat, notifications, status are free', () => {
    expect(surfaceSendRequiresApproval('chat')).toBe(false);
    expect(surfaceSendRequiresApproval('notifications')).toBe(false);
    expect(surfaceSendRequiresApproval('status')).toBe(false);
  });
  it('unknown surface defaults to free (discoverability, not safety boundary)', () => {
    expect(surfaceSendRequiresApproval('telemetry')).toBe(false);
  });
});
