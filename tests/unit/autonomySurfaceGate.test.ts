// autonomySurfaceGate.test.ts — M60 §3.8 surface-flag enforcement on
// SurfaceRouterService + §3.10 event emit.
//
// Verifies:
//   - When a surface's flag is OFF, send() refuses with a structured
//     error AND emits a `gated` autonomy event.
//   - When the flag is ON, send() routes through the underlying plugin
//     AND emits a `completed` event with surfaceRoutes recorded.
//   - When no flags service is installed, gating is disabled (back-compat).

import { describe, expect, it, vi } from 'vitest';
import { SurfaceRouterService } from '../../src/services/surfaceRouterService';
import {
  AutonomyFeatureFlagsService,
  FLAG_SURFACE_CANVAS_ENABLED,
} from '../../src/services/autonomyFeatureFlags';
import type {
  IAutonomyEventInput,
  IAutonomyEventLog,
  IAutonomyEventRecord,
} from '../../src/services/autonomyEventLog';
import type { ISurfacePlugin, ISurfaceDelivery } from '../../src/openclaw/openclawSurfacePlugin';

function makePlugin(id: string): ISurfacePlugin & { sent: ISurfaceDelivery[] } {
  const sent: ISurfaceDelivery[] = [];
  return {
    id,
    capabilities: {
      supportsText: true,
      supportsStructured: true,
      supportsBinary: false,
      supportsActions: false,
    },
    isAvailable: () => true,
    async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
      sent.push(delivery);
      return true;
    },
    dispose: () => undefined,
    sent,
  } as unknown as ISurfacePlugin & { sent: ISurfaceDelivery[] };
}

function makeFakeEventLog(): IAutonomyEventLog & { records: IAutonomyEventRecord[] } {
  const records: IAutonomyEventRecord[] = [];
  let seq = 0;
  return {
    records,
    emit(input: IAutonomyEventInput) {
      const r: IAutonomyEventRecord = {
        id: `id-${++seq}`,
        triggeredAt: new Date().toISOString(),
        ...input,
      };
      records.push(r);
      return r;
    },
    async readDay() { return records; },
    async findById(id: string) { return records.find(r => r.id === id); },
    onDidEmit: (() => ({ dispose: () => undefined })) as never,
    dispose: () => undefined,
  } as unknown as IAutonomyEventLog & { records: IAutonomyEventRecord[] };
}

describe('SurfaceRouterService gating (M60 §3.8 + §3.10)', () => {
  it('refuses delivery when the surface flag is off and emits a gated event', async () => {
    const router = new SurfaceRouterService();
    const flags = new AutonomyFeatureFlagsService(undefined);
    await flags.initialize();
    const log = makeFakeEventLog();
    router.setFeatureFlags(flags);
    router.setEventLog(log);

    const canvas = makePlugin('canvas');
    router.registerSurface(canvas);

    // Default for canvas is OFF per §3.8.
    expect(flags.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(false);

    const result = await router.send({
      surfaceId: 'canvas',
      contentType: 'text',
      content: 'hello',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/disabled by feature flag/);
    expect(canvas.sent).toHaveLength(0);
    expect(log.records).toHaveLength(1);
    expect(log.records[0].outcome).toBe('gated');
    expect(log.records[0].surfaceRoutes?.[0]).toMatchObject({
      surface: 'canvas',
      ok: false,
      reason: 'gated',
    });
  });

  it('routes through and emits a completed event when the flag is on', async () => {
    const router = new SurfaceRouterService();
    const flags = new AutonomyFeatureFlagsService(undefined);
    await flags.initialize();
    await flags.setEnabled(FLAG_SURFACE_CANVAS_ENABLED, true);
    const log = makeFakeEventLog();
    router.setFeatureFlags(flags);
    router.setEventLog(log);

    const canvas = makePlugin('canvas');
    router.registerSurface(canvas);

    const result = await router.send({
      surfaceId: 'canvas',
      contentType: 'text',
      content: 'hello',
    });

    expect(result.status).toBe('delivered');
    expect(canvas.sent).toHaveLength(1);
    expect(log.records).toHaveLength(1);
    expect(log.records[0].outcome).toBe('completed');
    expect(log.records[0].surfaceRoutes?.[0]).toMatchObject({
      surface: 'canvas',
      ok: true,
    });
  });

  it('back-compat: no flags service → no gating', async () => {
    const router = new SurfaceRouterService();
    const canvas = makePlugin('canvas');
    router.registerSurface(canvas);
    const result = await router.send({
      surfaceId: 'canvas',
      contentType: 'text',
      content: 'hello',
    });
    expect(result.status).toBe('delivered');
    expect(canvas.sent).toHaveLength(1);
  });
});
