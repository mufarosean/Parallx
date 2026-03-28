import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  SurfaceRouter,
  MAX_DELIVERY_RETRIES,
  MAX_DELIVERY_QUEUE_SIZE,
  SURFACE_CHAT,
  SURFACE_CANVAS,
  SURFACE_FILESYSTEM,
  SURFACE_NOTIFICATIONS,
  SURFACE_STATUS,
  type ISurfacePlugin,
  type ISurfaceCapabilities,
  type ISurfaceDelivery,
  type ISurfaceDeliveryParams,
} from '../../src/openclaw/openclawSurfacePlugin';

// ---------------------------------------------------------------------------
// Mock surface factory
// ---------------------------------------------------------------------------

function createMockSurface(
  id: string,
  overrides?: Partial<{
    capabilities: Partial<ISurfaceCapabilities>;
    available: boolean;
    deliverResult: boolean;
    deliverThrows: boolean;
  }>,
): ISurfacePlugin & { deliver: ReturnType<typeof vi.fn> } {
  const caps: ISurfaceCapabilities = {
    supportsText: true,
    supportsStructured: true,
    supportsBinary: false,
    supportsActions: false,
    ...overrides?.capabilities,
  };

  const deliver = overrides?.deliverThrows
    ? vi.fn().mockRejectedValue(new Error('deliver failed'))
    : vi.fn().mockResolvedValue(overrides?.deliverResult ?? true);

  return {
    id,
    capabilities: caps,
    isAvailable: () => overrides?.available ?? true,
    deliver,
    dispose: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// SurfaceRouter
// ---------------------------------------------------------------------------

describe('SurfaceRouter', () => {
  describe('surface registration', () => {
    it('registers a surface', () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat');

      router.registerSurface(surface);

      expect(router.surfaceCount).toBe(1);
      expect(router.surfaceIds).toContain('chat');

      router.dispose();
    });

    it('retrieves a registered surface', () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat');

      router.registerSurface(surface);

      expect(router.getSurface('chat')).toBe(surface);

      router.dispose();
    });

    it('rejects duplicate registration', () => {
      const router = new SurfaceRouter();
      router.registerSurface(createMockSurface('chat'));

      expect(() => router.registerSurface(createMockSurface('chat')))
        .toThrow(/already registered/i);

      router.dispose();
    });

    it('unregisters a surface', () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat');
      router.registerSurface(surface);

      expect(router.unregisterSurface('chat')).toBe(true);
      expect(router.surfaceCount).toBe(0);
      expect(surface.dispose).toHaveBeenCalled();

      router.dispose();
    });

    it('returns false for unknown unregister', () => {
      const router = new SurfaceRouter();

      expect(router.unregisterSurface('nonexistent')).toBe(false);

      router.dispose();
    });

    it('throws after dispose', () => {
      const router = new SurfaceRouter();
      router.dispose();

      expect(() => router.registerSurface(createMockSurface('chat')))
        .toThrow(/disposed/i);
    });
  });

  describe('send', () => {
    it('delivers text to a surface', async () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat');
      router.registerSurface(surface);

      const result = await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'Hello world',
      });

      expect(result.status).toBe('delivered');
      expect(result.surfaceId).toBe('chat');
      expect(result.error).toBeNull();
      expect(surface.deliver).toHaveBeenCalledTimes(1);

      router.dispose();
    });

    it('fails for unknown surface', async () => {
      const router = new SurfaceRouter();

      const result = await router.send({
        surfaceId: 'nonexistent',
        contentType: 'text',
        content: 'Hello',
      });

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/not found/i);

      router.dispose();
    });

    it('fails when surface is unavailable', async () => {
      const router = new SurfaceRouter();
      router.registerSurface(createMockSurface('chat', { available: false }));

      const result = await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'Hello',
      });

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/not available/i);

      router.dispose();
    });

    it('fails when content type is unsupported', async () => {
      const router = new SurfaceRouter();
      router.registerSurface(createMockSurface('chat', {
        capabilities: { supportsBinary: false },
      }));

      const result = await router.send({
        surfaceId: 'chat',
        contentType: 'binary',
        content: Buffer.from('data'),
      });

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/does not support/i);

      router.dispose();
    });

    it('includes metadata in delivery', async () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat');
      router.registerSurface(surface);

      await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'Hello',
        metadata: { priority: 'high' },
      });

      const delivery = surface.deliver.mock.calls[0][0] as ISurfaceDelivery;
      expect(delivery.metadata).toEqual({ priority: 'high' });

      router.dispose();
    });

    it('records delivery in history', async () => {
      const router = new SurfaceRouter();
      router.registerSurface(createMockSurface('chat'));

      await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'Hello',
      });

      expect(router.deliveryHistory).toHaveLength(1);
      expect(router.deliveryHistory[0].status).toBe('delivered');

      router.dispose();
    });

    it('throws after dispose', async () => {
      const router = new SurfaceRouter();
      router.dispose();

      await expect(router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'Hello',
      })).rejects.toThrow(/disposed/i);
    });
  });

  describe('retry logic', () => {
    it('retries on delivery failure', async () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat');
      // Fail first, succeed on retry
      surface.deliver
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      router.registerSurface(surface);

      const result = await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'retry me',
      });

      expect(result.status).toBe('delivered');
      expect(surface.deliver).toHaveBeenCalledTimes(2);

      router.dispose();
    });

    it('retries on delivery exception', async () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat');
      surface.deliver
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(true);
      router.registerSurface(surface);

      const result = await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'retry me',
      });

      expect(result.status).toBe('delivered');
      expect(surface.deliver).toHaveBeenCalledTimes(2);

      router.dispose();
    });

    it('fails after max retries exhausted', async () => {
      const router = new SurfaceRouter();
      const surface = createMockSurface('chat', { deliverThrows: true });
      router.registerSurface(surface);

      const result = await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'fail forever',
      });

      expect(result.status).toBe('failed');
      expect(result.error).toBeTruthy();
      // 1 initial + MAX_DELIVERY_RETRIES retries
      expect(surface.deliver).toHaveBeenCalledTimes(MAX_DELIVERY_RETRIES + 1);

      router.dispose();
    });

    it('records failed delivery in history', async () => {
      const router = new SurfaceRouter();
      router.registerSurface(createMockSurface('chat', { deliverThrows: true }));

      await router.send({
        surfaceId: 'chat',
        contentType: 'text',
        content: 'fail',
      });

      expect(router.deliveryHistory).toHaveLength(1);
      expect(router.deliveryHistory[0].status).toBe('failed');

      router.dispose();
    });
  });

  describe('broadcast', () => {
    it('delivers to all compatible surfaces', async () => {
      const router = new SurfaceRouter();
      const chat = createMockSurface('chat');
      const canvas = createMockSurface('canvas');
      router.registerSurface(chat);
      router.registerSurface(canvas);

      const results = await router.broadcast('text', 'Hello all');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'delivered')).toBe(true);
      expect(chat.deliver).toHaveBeenCalledTimes(1);
      expect(canvas.deliver).toHaveBeenCalledTimes(1);

      router.dispose();
    });

    it('skips unavailable surfaces', async () => {
      const router = new SurfaceRouter();
      router.registerSurface(createMockSurface('chat'));
      router.registerSurface(createMockSurface('canvas', { available: false }));

      const results = await router.broadcast('text', 'Hello');

      expect(results).toHaveLength(1);
      expect(results[0].surfaceId).toBe('chat');

      router.dispose();
    });

    it('skips surfaces that do not support the content type', async () => {
      const router = new SurfaceRouter();
      router.registerSurface(createMockSurface('chat', {
        capabilities: { supportsBinary: true },
      }));
      router.registerSurface(createMockSurface('canvas', {
        capabilities: { supportsBinary: false },
      }));

      const results = await router.broadcast('binary', Buffer.from('data'));

      expect(results).toHaveLength(1);
      expect(results[0].surfaceId).toBe('chat');

      router.dispose();
    });

    it('throws after dispose', async () => {
      const router = new SurfaceRouter();
      router.dispose();

      await expect(router.broadcast('text', 'Hello')).rejects.toThrow(/disposed/i);
    });
  });

  describe('dispose', () => {
    it('disposes all registered surfaces', () => {
      const router = new SurfaceRouter();
      const s1 = createMockSurface('chat');
      const s2 = createMockSurface('canvas');
      router.registerSurface(s1);
      router.registerSurface(s2);

      router.dispose();

      expect(s1.dispose).toHaveBeenCalled();
      expect(s2.dispose).toHaveBeenCalled();
      expect(router.surfaceCount).toBe(0);
    });

    it('clears delivery history', () => {
      const router = new SurfaceRouter();
      router.dispose();

      expect(router.deliveryHistory).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('surface constants', () => {
  it('well-known surface IDs are defined', () => {
    expect(SURFACE_CHAT).toBe('chat');
    expect(SURFACE_CANVAS).toBe('canvas');
    expect(SURFACE_FILESYSTEM).toBe('filesystem');
    expect(SURFACE_NOTIFICATIONS).toBe('notifications');
    expect(SURFACE_STATUS).toBe('status');
  });

  it('MAX_DELIVERY_QUEUE_SIZE is reasonable', () => {
    expect(MAX_DELIVERY_QUEUE_SIZE).toBeGreaterThanOrEqual(10);
    expect(MAX_DELIVERY_QUEUE_SIZE).toBeLessThanOrEqual(1000);
  });

  it('MAX_DELIVERY_RETRIES is reasonable', () => {
    expect(MAX_DELIVERY_RETRIES).toBeGreaterThanOrEqual(1);
    expect(MAX_DELIVERY_RETRIES).toBeLessThanOrEqual(10);
  });
});
