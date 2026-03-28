/**
 * Multi-Surface Output — D6: Dashboard Tools.
 *
 * Upstream evidence:
 *   - ChannelPlugin interface across src/channels/ —
 *     setup(), config(), security, messaging, outbound
 *   - All channels simultaneously active
 *   - Session keys: agent:{agentId}:{channel}:{scope}:{peerId}
 *   - Message routing: message-tool reaches any connected platform
 *   - Delivery queue with ack/fail tracking
 *   - Media filtering per channel
 *
 * Parallx adaptation:
 *   - NOT multi-channel messaging (Telegram, Discord, etc.)
 *   - IS multi-surface output: AI pushes content to dashboard surfaces beyond chat
 *   - Surface plugins: canvas updates, file operations, status bar, notification toasts
 *   - Agent can proactively update workspace (file writes, canvas edits) without chat prompt
 *   - Maps to: ISurfacePlugin interface replacing ChannelPlugin
 *   - Each surface: chat (default), canvas, filesystem, notifications, status
 */

import type { IDisposable } from '../platform/lifecycle.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum queued deliveries per surface before dropping oldest. */
export const MAX_DELIVERY_QUEUE_SIZE = 100;

/** Delivery retry limit before marking as failed. */
export const MAX_DELIVERY_RETRIES = 3;

/** Well-known surface IDs. */
export const SURFACE_CHAT = 'chat';
export const SURFACE_CANVAS = 'canvas';
export const SURFACE_FILESYSTEM = 'filesystem';
export const SURFACE_NOTIFICATIONS = 'notifications';
export const SURFACE_STATUS = 'status';

// ---------------------------------------------------------------------------
// Types (adapted from upstream ChannelPlugin)
// ---------------------------------------------------------------------------

/**
 * Content type for a surface delivery.
 */
export type SurfaceContentType =
  | 'text'        // plain text or markdown
  | 'structured'  // JSON/structured data
  | 'binary'      // file content
  | 'action';     // UI action trigger

/**
 * Delivery status.
 * Upstream: ack/fail tracking in delivery queue.
 */
export type DeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'dropped';

/**
 * A surface delivery payload.
 * Upstream: outbound message in channel plugin.
 */
export interface ISurfaceDelivery {
  readonly id: string;
  readonly surfaceId: string;
  readonly contentType: SurfaceContentType;
  readonly content: unknown;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
  readonly status: DeliveryStatus;
  readonly retries: number;
  readonly error: string | null;
}

/**
 * Parameters for creating a delivery.
 */
export interface ISurfaceDeliveryParams {
  readonly surfaceId: string;
  readonly contentType: SurfaceContentType;
  readonly content: unknown;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Surface capabilities — what a surface can handle.
 * Upstream: media filtering per channel.
 */
export interface ISurfaceCapabilities {
  readonly supportsText: boolean;
  readonly supportsStructured: boolean;
  readonly supportsBinary: boolean;
  readonly supportsActions: boolean;
  readonly maxContentSize?: number;
}

/**
 * Surface plugin interface — the Parallx adaptation of upstream ChannelPlugin.
 *
 * Upstream ChannelPlugin:
 *   setup() — initialize
 *   config() — channel config
 *   security — security resolver
 *   messaging — inbound handler
 *   outbound — delivery handler
 *
 * Parallx ISurfacePlugin:
 *   id — surface identifier
 *   capabilities — what content types are supported
 *   deliver() — push content to the surface
 *   isAvailable() — check if surface is ready
 */
export interface ISurfacePlugin extends IDisposable {
  readonly id: string;
  readonly capabilities: ISurfaceCapabilities;

  /** Check if the surface is available and ready. */
  isAvailable(): boolean;

  /** Deliver content to this surface. */
  deliver(delivery: ISurfaceDelivery): Promise<boolean>;
}

/**
 * Result of a surface delivery attempt.
 */
export interface IDeliveryResult {
  readonly deliveryId: string;
  readonly surfaceId: string;
  readonly status: DeliveryStatus;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Surface Router
// ---------------------------------------------------------------------------

/**
 * Routes deliveries to registered surface plugins.
 *
 * Upstream: message-tool routes to any connected platform.
 * Parallx: SurfaceRouter manages registered surfaces, queues deliveries,
 * handles retries, and tracks delivery status.
 */
export class SurfaceRouter implements IDisposable {
  private readonly _surfaces = new Map<string, ISurfacePlugin>();
  private readonly _deliveryQueue: ISurfaceDelivery[] = [];
  private readonly _deliveryHistory: ISurfaceDelivery[] = [];
  private _nextDeliveryId = 1;
  private _disposed = false;

  // -----------------------------------------------------------------------
  // Surface registration
  // -----------------------------------------------------------------------

  /**
   * Register a surface plugin.
   * Upstream: channel registration on server startup.
   */
  registerSurface(plugin: ISurfacePlugin): void {
    if (this._disposed) throw new Error('SurfaceRouter is disposed');
    if (this._surfaces.has(plugin.id)) {
      throw new Error(`Surface already registered: ${plugin.id}`);
    }
    this._surfaces.set(plugin.id, plugin);
  }

  /**
   * Unregister a surface plugin.
   */
  unregisterSurface(id: string): boolean {
    const plugin = this._surfaces.get(id);
    if (plugin) {
      plugin.dispose();
      this._surfaces.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Get a registered surface by ID.
   */
  getSurface(id: string): ISurfacePlugin | undefined {
    return this._surfaces.get(id);
  }

  /** All registered surface IDs. */
  get surfaceIds(): readonly string[] {
    return [...this._surfaces.keys()];
  }

  /** Number of registered surfaces. */
  get surfaceCount(): number {
    return this._surfaces.size;
  }

  // -----------------------------------------------------------------------
  // Delivery — upstream: outbound delivery + ack/fail tracking
  // -----------------------------------------------------------------------

  /**
   * Send content to a surface.
   * Upstream: message-tool delivery with ack/fail tracking.
   */
  async send(params: ISurfaceDeliveryParams): Promise<IDeliveryResult> {
    if (this._disposed) throw new Error('SurfaceRouter is disposed');

    const surface = this._surfaces.get(params.surfaceId);
    if (!surface) {
      return {
        deliveryId: '',
        surfaceId: params.surfaceId,
        status: 'failed',
        error: `Surface not found: ${params.surfaceId}`,
      };
    }

    // Check surface availability
    if (!surface.isAvailable()) {
      return {
        deliveryId: '',
        surfaceId: params.surfaceId,
        status: 'failed',
        error: `Surface not available: ${params.surfaceId}`,
      };
    }

    // Check content type capability — upstream: media filtering per channel
    if (!isContentSupported(surface.capabilities, params.contentType)) {
      return {
        deliveryId: '',
        surfaceId: params.surfaceId,
        status: 'failed',
        error: `Surface ${params.surfaceId} does not support content type: ${params.contentType}`,
      };
    }

    // Create delivery record
    const delivery: ISurfaceDelivery = {
      id: `delivery-${this._nextDeliveryId++}`,
      surfaceId: params.surfaceId,
      contentType: params.contentType,
      content: params.content,
      metadata: params.metadata ?? {},
      createdAt: Date.now(),
      status: 'pending',
      retries: 0,
      error: null,
    };

    // Attempt delivery with retries — upstream: delivery queue with retry
    return this._deliverWithRetry(delivery, surface);
  }

  /**
   * Broadcast content to all surfaces that support the content type.
   * Upstream: multi-channel simultaneous delivery.
   */
  async broadcast(
    contentType: SurfaceContentType,
    content: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<readonly IDeliveryResult[]> {
    if (this._disposed) throw new Error('SurfaceRouter is disposed');

    const results: IDeliveryResult[] = [];

    for (const [surfaceId, surface] of this._surfaces) {
      if (!surface.isAvailable()) continue;
      if (!isContentSupported(surface.capabilities, contentType)) continue;

      const result = await this.send({
        surfaceId,
        contentType,
        content,
        metadata,
      });
      results.push(result);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Queue management
  // -----------------------------------------------------------------------

  /** Pending deliveries. */
  get pendingCount(): number {
    return this._deliveryQueue.length;
  }

  /** Delivery history (delivered + failed). */
  get deliveryHistory(): readonly ISurfaceDelivery[] {
    return [...this._deliveryHistory];
  }

  // -----------------------------------------------------------------------
  // Internal — delivery with retry
  // -----------------------------------------------------------------------

  private async _deliverWithRetry(
    delivery: ISurfaceDelivery,
    surface: ISurfacePlugin,
  ): Promise<IDeliveryResult> {
    let current = delivery;

    for (let attempt = 0; attempt <= MAX_DELIVERY_RETRIES; attempt++) {
      try {
        const success = await surface.deliver(current);

        if (success) {
          const delivered: ISurfaceDelivery = {
            ...current,
            status: 'delivered',
            retries: attempt,
          };
          this._deliveryHistory.push(delivered);

          return {
            deliveryId: delivered.id,
            surfaceId: delivered.surfaceId,
            status: 'delivered',
            error: null,
          };
        }

        // Surface returned false — treat as soft failure
        current = { ...current, retries: attempt + 1 };

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        current = {
          ...current,
          retries: attempt + 1,
          error: errorMsg,
        };
      }
    }

    // All retries exhausted
    const failed: ISurfaceDelivery = {
      ...current,
      status: 'failed',
    };
    this._deliveryHistory.push(failed);

    // Manage queue size
    if (this._deliveryHistory.length > MAX_DELIVERY_QUEUE_SIZE) {
      this._deliveryHistory.splice(0, this._deliveryHistory.length - MAX_DELIVERY_QUEUE_SIZE);
    }

    return {
      deliveryId: failed.id,
      surfaceId: failed.surfaceId,
      status: 'failed',
      error: failed.error ?? 'Delivery failed after max retries',
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    this._disposed = true;
    for (const [, surface] of this._surfaces) {
      surface.dispose();
    }
    this._surfaces.clear();
    this._deliveryQueue.length = 0;
    this._deliveryHistory.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isContentSupported(
  capabilities: ISurfaceCapabilities,
  contentType: SurfaceContentType,
): boolean {
  switch (contentType) {
    case 'text': return capabilities.supportsText;
    case 'structured': return capabilities.supportsStructured;
    case 'binary': return capabilities.supportsBinary;
    case 'action': return capabilities.supportsActions;
    default: return false;
  }
}
