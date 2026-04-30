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
import {
  SURFACE_FLAG_BY_ID,
  type IAutonomyFeatureFlagsService,
} from './autonomyFeatureFlags.js';
import type { IAutonomyEventLog } from './autonomyEventLog.js';

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

  /**
   * M60 §3.8: install/replace the autonomy feature-flag service used to
   * gate per-surface deliveries. Setter (rather than constructor arg) so
   * the workbench can wire after activation, before the chat extension
   * starts dispatching. Calling with `undefined` removes gating.
   */
  setFeatureFlags(flags: IAutonomyFeatureFlagsService | undefined): void;

  /**
   * M60 §3.10: install/replace the structured event log so every route
   * attempt produces an autonomy event record (success, gated, error).
   */
  setEventLog(log: IAutonomyEventLog | undefined): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SurfaceRouterService extends Disposable implements ISurfaceRouterService {
  private readonly _router: SurfaceRouter;
  private _flags: IAutonomyFeatureFlagsService | undefined;
  private _eventLog: IAutonomyEventLog | undefined;

  constructor() {
    super();
    this._router = new SurfaceRouter();
    this._register({ dispose: () => this._router.dispose() });
  }

  setFeatureFlags(flags: IAutonomyFeatureFlagsService | undefined): void {
    this._flags = flags;
  }

  setEventLog(log: IAutonomyEventLog | undefined): void {
    this._eventLog = log;
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
    return this._sendGated(params, undefined);
  }

  sendWithOrigin(params: ISurfaceDeliveryParams, origin: string): Promise<IDeliveryResult> {
    // Stamp the origin into the metadata before dispatch. Caller-supplied
    // metadata wins everywhere except for the origin key itself — the guard
    // is only useful if it reliably reflects who actually authored the send.
    const metadata: Record<string, unknown> = {
      ...(params.metadata ?? {}),
      [SURFACE_ORIGIN_KEY]: origin,
    };
    return this._sendGated({ ...params, metadata }, origin);
  }

  /**
   * Shared dispatch path: enforces the §3.8 surface-enable flags and emits
   * a §3.10 autonomy event for every route attempt (success, gated, error).
   */
  private async _sendGated(
    params: ISurfaceDeliveryParams,
    origin: string | undefined,
  ): Promise<IDeliveryResult> {
    const flagId = SURFACE_FLAG_BY_ID[params.surfaceId];
    if (this._flags && flagId && !this._flags.isEnabled(flagId)) {
      // Gated: refuse the route. Caller treats this as an error path.
      this._eventLog?.emit({
        trigger: { kind: this._triggerKindForOrigin(origin), ref: origin },
        outcome: 'gated',
        surfaceRoutes: [{ surface: params.surfaceId, ok: false, reason: 'gated' }],
        note: `surface gated by ${flagId}`,
      });
      return {
        deliveryId: '',
        surfaceId: params.surfaceId,
        status: 'failed',
        error: `Surface "${params.surfaceId}" is disabled by feature flag (${flagId})`,
      };
    }

    const t0 = Date.now();
    const result = await this._router.send(params);
    const duration = Date.now() - t0;
    this._eventLog?.emit({
      trigger: { kind: this._triggerKindForOrigin(origin), ref: origin },
      outcome: result.status === 'delivered' ? 'completed' : 'error',
      surfaceRoutes: [{
        surface: params.surfaceId,
        ok: result.status === 'delivered',
        reason: result.status === 'delivered' ? undefined : (result.error ?? 'route-failed'),
      }],
      durationMs: duration,
    });
    return result;
  }

  private _triggerKindForOrigin(origin: string | undefined): import('./autonomyEventLog.js').AutonomyTriggerKind {
    switch (origin) {
      case 'cron': return 'cron';
      case 'heartbeat': return 'heartbeat';
      case 'subagent': return 'subagent';
      default: return 'chat';
    }
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
