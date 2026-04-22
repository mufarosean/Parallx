// surfaceRouterService.ts — DI service facade for the SurfaceRouter (M58 W6)
//
// Wraps the audit-closed `SurfaceRouter` (src/openclaw/openclawSurfacePlugin.ts,
// D6 13/13 ALIGNED) with an ISurfaceRouterService identifier so the workbench
// can register it once, all extensions can share it, and the feedback-loop
// origin-tag is surfaced as a first-class API for later heartbeat wiring (W2).
//
// Upstream parity:
//   - ChannelPlugin registry pattern — one router, many channels/surfaces
//     (github.com/openclaw/openclaw src/channels/)
//   - Message-tool dispatch by surfaceId (upstream: channelId)
//
// Parallx adaptation:
//   - Single-process desktop: one router owned by the workbench lifecycle
//   - Origin tag in delivery metadata breaks surface→heartbeat→surface loops
//     (M58 risk register, §8)

import { Disposable } from '../platform/lifecycle.js';
import {
  SurfaceRouter,
  type ISurfacePlugin,
  type ISurfaceDeliveryParams,
  type ISurfaceDelivery,
  type IDeliveryResult,
  type SurfaceContentType,
} from '../openclaw/openclawSurfacePlugin.js';

// ---------------------------------------------------------------------------
// Origin tag — used by the feedback-loop guard
// ---------------------------------------------------------------------------

/**
 * Metadata key stamped into every delivery so consumers (heartbeat, etc.)
 * can identify who authored a surface write and skip their own echoes.
 *
 * Upstream analog: message origin carried through channel outbound metadata.
 */
export const SURFACE_ORIGIN_KEY = '_origin';

/** Well-known origin values. */
export const ORIGIN_USER = 'user';
export const ORIGIN_AGENT = 'agent';
export const ORIGIN_HEARTBEAT = 'heartbeat';
export const ORIGIN_CRON = 'cron';
export const ORIGIN_SUBAGENT = 'subagent';

/**
 * Extract the origin tag from a delivery's metadata (if present).
 */
export function getDeliveryOrigin(delivery: ISurfaceDelivery): string | undefined {
  const raw = delivery.metadata[SURFACE_ORIGIN_KEY];
  return typeof raw === 'string' ? raw : undefined;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Service contract for the workbench-owned SurfaceRouter.
 *
 * Separate from `SurfaceRouter` the class so the service identifier can be
 * exposed from `serviceTypes.ts` without that file importing the openclaw
 * module directly (keeps service-layer code free of openclaw coupling).
 */
export interface ISurfaceRouterService extends Disposable {
  /** Register a surface plugin. */
  registerSurface(plugin: ISurfacePlugin): void;
  /** Unregister a surface plugin by id. */
  unregisterSurface(id: string): boolean;
  /** Get a surface by id. */
  getSurface(id: string): ISurfacePlugin | undefined;
  /** All registered surface ids (read-only snapshot). */
  readonly surfaceIds: readonly string[];
  /** Number of registered surfaces. */
  readonly surfaceCount: number;

  /** Send content to a single surface. */
  send(params: ISurfaceDeliveryParams): Promise<IDeliveryResult>;
  /**
   * Send content with an origin tag stamped into metadata.
   *
   * The origin is written to `metadata._origin`; a heartbeat/cron consumer
   * can then call `getDeliveryOrigin` on history entries to avoid treating
   * its own writes as new events to react to.
   */
  sendWithOrigin(params: ISurfaceDeliveryParams, origin: string): Promise<IDeliveryResult>;
  /** Broadcast content to every surface that supports the content type. */
  broadcast(
    contentType: SurfaceContentType,
    content: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<readonly IDeliveryResult[]>;

  /** Delivery history (delivered + failed), newest-first not guaranteed. */
  readonly deliveryHistory: readonly ISurfaceDelivery[];
  /** Filter delivery history by origin tag. */
  getDeliveriesByOrigin(origin: string): readonly ISurfaceDelivery[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SurfaceRouterService extends Disposable implements ISurfaceRouterService {
  private readonly _router: SurfaceRouter;

  constructor() {
    super();
    this._router = new SurfaceRouter();
    this._register({ dispose: () => this._router.dispose() });
  }

  registerSurface(plugin: ISurfacePlugin): void {
    this._router.registerSurface(plugin);
  }

  unregisterSurface(id: string): boolean {
    return this._router.unregisterSurface(id);
  }

  getSurface(id: string): ISurfacePlugin | undefined {
    return this._router.getSurface(id);
  }

  get surfaceIds(): readonly string[] {
    return this._router.surfaceIds;
  }

  get surfaceCount(): number {
    return this._router.surfaceCount;
  }

  send(params: ISurfaceDeliveryParams): Promise<IDeliveryResult> {
    return this._router.send(params);
  }

  sendWithOrigin(params: ISurfaceDeliveryParams, origin: string): Promise<IDeliveryResult> {
    // Stamp the origin into the metadata before dispatch. Caller-supplied
    // metadata wins everywhere except for the origin key itself — the guard
    // is only useful if it reliably reflects who actually authored the send.
    const metadata: Record<string, unknown> = {
      ...(params.metadata ?? {}),
      [SURFACE_ORIGIN_KEY]: origin,
    };
    return this._router.send({ ...params, metadata });
  }

  broadcast(
    contentType: SurfaceContentType,
    content: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<readonly IDeliveryResult[]> {
    return this._router.broadcast(contentType, content, metadata);
  }

  get deliveryHistory(): readonly ISurfaceDelivery[] {
    return this._router.deliveryHistory;
  }

  getDeliveriesByOrigin(origin: string): readonly ISurfaceDelivery[] {
    return this._router.deliveryHistory.filter(
      d => getDeliveryOrigin(d) === origin,
    );
  }
}
